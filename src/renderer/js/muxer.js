/**
 * fMP4 封装：把 scrcpy 送来的 H.264 包封成浏览器能直接播放的形式。
 *
 * 为什么自己写：
 *   <video> 不能直接吃裸 H.264，必须套容器。常见做法是引 webm-muxer 之类的库，
 *   这里只实现单视频轨需要的最小 fMP4 box，几百行、零依赖、零体积增加。
 *
 * 结构：
 *   ftyp + moov（含 avcC，即 SPS/PPS）  —— 初始化段，会话开始写一次
 *   moof + mdat                          —— 每帧一个媒体段
 *
 * 时间：90kHz 时基，帧时长取相邻帧的真实间隔，播放速度与手机一致。
 */

/** 视频时间基 */
const 时间基 = 90000;

/* ------------------------------------------------------------------ */
/* 字节写入                                                            */
/* ------------------------------------------------------------------ */

class 写入器 {
  constructor() {
    this.块 = [];
  }

  bytes(...值) {
    this.块.push(Uint8Array.from(值));
    return this;
  }

  raw(数组) {
    this.块.push(数组);
    return this;
  }

  u16(值) {
    this.块.push(Uint8Array.from([(值 >>> 8) & 0xff, 值 & 0xff]));
    return this;
  }

  u32(值) {
    this.块.push(
      Uint8Array.from([(值 >>> 24) & 0xff, (值 >>> 16) & 0xff, (值 >>> 8) & 0xff, 值 & 0xff]),
    );
    return this;
  }

  fourcc(字符串) {
    this.块.push(Uint8Array.from(字符串.split('').map((字符) => 字符.charCodeAt(0))));
    return this;
  }

  zeros(数量) {
    this.块.push(new Uint8Array(数量));
    return this;
  }

  /** 写一个 box：先占位长度，回调写完内容后回填 */
  box(类型, 写内容) {
    const 子 = new 写入器();
    写内容(子);
    const 内容 = 子.done();
    this.u32(8 + 内容.length);
    this.fourcc(类型);
    this.块.push(内容);
    return this;
  }

  done() {
    const 总长 = this.块.reduce((和, 块) => 和 + 块.length, 0);
    const 结果 = new Uint8Array(总长);
    let 偏移 = 0;
    for (const 块 of this.块) {
      结果.set(块, 偏移);
      偏移 += 块.length;
    }
    return 结果;
  }
}

/* ------------------------------------------------------------------ */
/* 码流工具                                                            */
/* ------------------------------------------------------------------ */

/** 把 Annex-B 字节流切成裸 NALU（去掉起始码） */
function 切成NALU(字节) {
  const 结果 = [];
  let 起点 = -1;
  let i = 0;

  // 定位第一个起始码
  for (; i + 3 <= 字节.length; i += 1) {
    if (字节[i] === 0 && 字节[i + 1] === 0) {
      if (字节[i + 2] === 1) {
        起点 = i + 3;
        i = 起点;
        break;
      }
      if (i + 4 <= 字节.length && 字节[i + 2] === 0 && 字节[i + 3] === 1) {
        起点 = i + 4;
        i = 起点;
        break;
      }
    }
  }

  // 没有起始码：MediaCodec 的常见输出就是一整块 NALU
  if (起点 < 0) return 字节.length > 0 ? [字节] : [];

  while (i < 字节.length) {
    if (字节[i] === 0 && 字节[i + 1] === 0) {
      if (字节[i + 2] === 1) {
        结果.push(字节.subarray(起点, i));
        起点 = i + 3;
        i = 起点;
        continue;
      }
      if (i + 4 <= 字节.length && 字节[i + 2] === 0 && 字节[i + 3] === 1) {
        结果.push(字节.subarray(起点, i));
        起点 = i + 4;
        i = 起点;
        continue;
      }
    }
    i += 1;
  }
  if (起点 < 字节.length) 结果.push(字节.subarray(起点));

  return 结果.filter((nalu) => nalu.length > 0);
}

/** 数据里是否含 SPS(7) 或 PPS(8) */
function 含参数集(字节) {
  return 切成NALU(字节).some((nalu) => {
    const 类型 = nalu[0] & 0x1f;
    return 类型 === 7 || 类型 === 8;
  });
}

/**
 * 从 SPS 解析分辨率。
 * 返回 { width, height, displayWidth, displayHeight }，解析失败返回 null。
 *
 * 注意：不需要完整解析裁剪信息——视频流的真实尺寸由 scrcpy 的会话元信息给出，
 * 这里只需要一个「大致正确」的值来建 avcC。解析失败时调用方会用会话尺寸兜底。
 */
function 解析SPS(sps) {
  try {
    let 位 = 32; // 跳过 nal 头 + profile + level
    const 读位 = (数量) => {
      let 值 = 0;
      for (let k = 0; k < 数量; k += 1) {
        const 字节 = sps[位 >> 3];
        const 当前位 = (字节 >> (7 - (位 & 7))) & 1;
        值 = (值 << 1) | 当前位;
        位 += 1;
      }
      return 值;
    };

    读位(8); // sps id
    const profile = 读位(8);
    读位(8); // 兼容标志
    读位(8); // level

    const 序号类型 = 读位(8) % 32;
    if (![0, 1, 2, 3, 4, 5, 31].includes(序号类型)) return null;

    if (序号类型 === 3) 读位(1);
    读位(16); // seq_parameter_set_id
    if (序号类型 === 1 || 序号类型 === 2) 读位(1);
    读位(1); // gaps_in_frame_num

    const 结构数 = 读位(2);
    if (结构数 === 2) 读位(1);

    读位(16); // frame_num

    const 宽宏块 = 读位(16) + 1;
    const 高宏块 = 读位(16) + 1;
    const 宽 = 宽宏块 * 16;
    const 高 = 高宏块 * 16;

    // 合理性检查：异常值说明解析偏了，交给调用方用会话尺寸兜底
    if (宽 <= 0 || 高 <= 0 || 宽 > 16384 || 高 > 16384) return null;

    return { profile, width: 宽, height: 高, displayWidth: 宽, displayHeight: 高 };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* fMP4 构建                                                           */
/* ------------------------------------------------------------------ */

/** avcC（AVCDecoderConfigurationRecord） */
function 构建avcC(sps, pps) {
  return new 写入器()
    .bytes(1) // configurationVersion
    .bytes(sps[1]) // profile
    .bytes(sps[2]) // profile_compatibility
    .bytes(sps[3]) // level
    .bytes(0xff) // lengthSizeMinusOne = 3
    .bytes(0xe1) // 一个 SPS
    .u16(sps.length)
    .raw(sps)
    .bytes(1) // 一个 PPS
    .u16(pps.length)
    .raw(pps)
    .done();
}

/** 初始化段：ftyp + moov */
function 构建初始化段({ sps, pps, width, height }) {
  const avcC = 构建avcC(sps, pps);

  return new 写入器()
    .box('ftyp', (w) => w.fourcc('isom').u32(0x200).fourcc('isom').fourcc('avc1').fourcc('mp41'))
    .box('moov', (moov) => {
      // mvhd 字段顺序：creation(4) modification(4) timescale(4) duration(4) rate(4) volume(2) reserved(10)
      moov.box('mvhd', (w) => {
        w.u32(0); // version 0 + flags
        w.u32(0).u32(0); // creation / modification
        w.u32(1000); // timescale
        w.u32(0); // duration（分片流可以留 0）
        w.u32(0x00010000); // rate = 1.0
        w.u16(0x0100); // volume = 1.0
        w.zeros(10); // reserved[2] + matrix 前置
        for (let i = 0; i < 9; i += 1) w.u32(i === 0 || i === 4 ? 0x10000 : 0);
        w.zeros(24); // pre_defined[6]
        w.u32(2); // next_track_ID
      });

      moov.box('trak', (trak) => {
        trak.box('tkhd', (w) => {
          // tkhd：version/flags → creation → modification → track_id → reserved → duration
          w.u32(3).u32(0).u32(0).u32(1).u32(0).u32(0);
          w.zeros(8).u16(0).u16(0).u16(0).u16(0);
          for (let i = 0; i < 9; i += 1) w.u32(i === 0 || i === 4 ? 0x10000 : 0);
          w.u32(width * 0x10000).u32(height * 0x10000);
        });

        trak.box('mdia', (mdia) => {
          mdia.box('mdhd', (w) => w.u32(0).u32(0).u32(0).u32(时间基).u32(0).u16(0x55c4).u16(0));
          mdia.box('hdlr', (w) => w.u32(0).u32(0).fourcc('vide').u32(0).u32(0).u32(0).bytes(0));

          mdia.box('minf', (minf) => {
            minf.box('vmhd', (w) => w.u32(1).u16(0).u16(0).u16(0).u16(0));
            minf.box('dinf', (dinf) =>
              dinf.box('dref', (w) => w.u32(0).u32(1).box('url ', (u) => u.u32(1))),
            );
            minf.box('stbl', (stbl) => {
              stbl.box('stsd', (w) => {
                w.u32(0).u32(1);
                // avc1 视觉样本项：标准字段布局（合计 78 字节固定头 + 子 box）
                w.box('avc1', (avc1) => {
                  avc1.zeros(6); // reserved[6]
                  avc1.u16(1); // data_reference_index
                  avc1.zeros(16); // pre_defined[2] + reserved[2] + pre_defined[3]
                  avc1.u16(width).u16(height);
                  avc1.u32(0x00480000); // horizresolution 72dpi
                  avc1.u32(0x00480000); // vertresolution 72dpi
                  avc1.u32(0); // reserved
                  avc1.u16(1); // frame_count
                  avc1.zeros(32); // compressorname[32]
                  avc1.u16(0x0018); // depth = 24
                  avc1.u16(0xffff); // pre_defined = -1
                  avc1.box('avcC', (u) => u.raw(avcC));
                });
              });
              // 空样本表：分片流的实际样本都在 moof 里，这里保留结构完整性
              stbl.box('stts', (w) => w.u32(0).u32(0));
              stbl.box('stsc', (w) => w.u32(0).u32(0));
              stbl.box('stsz', (w) => w.u32(0).u32(0).u32(0));
              stbl.box('stco', (w) => w.u32(0).u32(0));
              stbl.box('stss', (w) => w.u32(0).u32(0));
            });
          });
        });
      });

      moov.box('mvex', (mvex) =>
        mvex.box('trex', (w) => w.u32(0).u32(1).u32(1).u32(0).u32(0).u32(0x10000)),
      );
    })
    .done();
}

/**
 * 媒体段：moof + mdat（一帧）。
 * @param {Uint8Array} 样本 4 字节长度前缀 + NALU
 * @param {number} 时长 90kHz 单位
 * @param {boolean} 关键帧
 * @param {number} 时间 解码时间（90kHz 单位）
 * @param {number} 序号 片段序号
 */
function 构建媒体段(样本, 时长, 关键帧, 时间, 序号) {
  const 构造 = (偏移) => {
    const w = new 写入器();
    w.box('moof', (moof) => {
      moof.box('mfhd', (m) => m.u32(0).u32(序号));
      moof.box('traf', (traf) => {
        traf.box('tfhd', (t) => t.u32(0x020000).u32(1));
        traf.box('tfdt', (t) => t.u32(1).u32(Math.floor(时间 / 4294967296)).u32(时间 >>> 0));
        traf.box('trun', (t) => {
          t.u32(0x000701); // data-offset + duration + size + flags
          t.u32(1);
          t.u32(偏移);
          t.u32(时长);
          t.u32(样本.length);
          t.u32(关键帧 ? 0x02000000 : 0x01010000);
        });
      });
    });
    return w.done();
  };

  // 数据偏移 = moof 长度 + mdat 头 8 字节；长度与偏移无关，迭代一次即收敛
  let moof = 构造(0);
  moof = 构造(moof.length + 8);

  const mdat = new 写入器().u32(8 + 样本.length).fourcc('mdat').raw(样本).done();

  const 结果 = new Uint8Array(moof.length + mdat.length);
  结果.set(moof, 0);
  结果.set(mdat, moof.length);
  return 结果;
}

/** 把一帧 Annex-B 转成样本（4 字节长度前缀），过滤 AUD/SPS/PPS */
function 组装样本(字节) {
  const nalu们 = 切成NALU(字节).filter((nalu) => {
    const 类型 = nalu[0] & 0x1f;
    return 类型 !== 9 && 类型 !== 7 && 类型 !== 8;
  });
  if (nalu们.length === 0) return null;

  const 总长 = nalu们.reduce((和, nalu) => 和 + 4 + nalu.length, 0);
  const 样本 = new Uint8Array(总长);
  let 偏移 = 0;
  for (const nalu of nalu们) {
    样本[偏移] = (nalu.length >>> 24) & 0xff;
    样本[偏移 + 1] = (nalu.length >>> 16) & 0xff;
    样本[偏移 + 2] = (nalu.length >>> 8) & 0xff;
    样本[偏移 + 3] = nalu.length & 0xff;
    偏移 += 4;
    样本.set(nalu, 偏移);
    偏移 += nalu.length;
  }
  return 样本;
}

export { 写入器, 切成NALU, 解析SPS, 含参数集, 构建初始化段, 构建媒体段, 组装样本, 时间基 };
