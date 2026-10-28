"""Aoid 抖音图文 —— 第一张（整体介绍 + 项目链接）。

修正上一版的三个问题：
  1. **橙色块位置偏了**：原来宽度写死 560px，但文字只有约 380px，
     右侧空出一大块，看起来就像整体偏左。现在改成
     「先量文字宽度 → 块宽 = 文字宽 + 左右内边距」，块会刚好包住文字。
  2. **第一张应该是整体介绍**：补上功能概览（两列八项）。
  3. **加项目链接**：github.com/l-xyzz/Aoid 用大号橙色字放在显眼处。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

宽, 高 = 1080, 1440

底 = (11, 13, 16)
强调 = (245, 165, 36)
白 = (255, 255, 255)
次 = (168, 176, 188)
弱 = (116, 124, 136)

粗 = "C:/Windows/Fonts/msyhbd.ttc"
常 = "C:/Windows/Fonts/msyh.ttc"


def F(路径, 大小):
    return ImageFont.truetype(路径, 大小)


def 量(f, 文本):
    """返回 (宽, 上边距, 下边距) —— 用 bbox 量，保证块能正好包住字"""
    b = f.getbbox(文本)
    return b[2] - b[0], b[1], b[3]


def 强调块(d, x, y, 文本, f, 内距x=28, 内距y=16, 圆角=16):
    """画一个刚好包住文字的橙色块（宽度自适应，这是修位置问题的关键）"""
    w, top, bottom = 量(f, 文本)
    块宽 = w + 内距x * 2
    块高 = (bottom - top) + 内距y * 2
    d.rounded_rectangle([x, y, x + 块宽, y + 块高], radius=圆角, fill=强调 + (255,))
    # 减去 bbox 上边距，文字才会在块里垂直居中
    d.text((x + 内距x, y + 内距y - top), 文本, font=f, fill=(15, 15, 18, 255))
    return 块宽, 块高


def 画布():
    im = Image.new("RGBA", (宽, 高), 底 + (255,))
    光 = Image.new("RGBA", (宽, 高), (0, 0, 0, 0))
    ImageDraw.Draw(光).ellipse([-340, -580, 宽 + 340, 300], fill=(245, 165, 36, 32))
    光 = 光.filter(ImageFilter.GaussianBlur(150))
    im.alpha_composite(光)
    return im


def 生成(输出):
    im = 画布()
    d = ImageDraw.Draw(im)

    # ---- 顶部品牌行 ----
    d.rounded_rectangle([70, 100, 93, 123], radius=6, fill=强调 + (255,))
    d.text((118, 86), "Aoid", font=F(粗, 38), fill=强调 + (255,))

    f版 = F(常, 28)
    w版, _, _ = 量(f版, "v1.0.0")
    d.text((宽 - 70 - w版, 100), "v1.0.0", font=f版, fill=弱 + (255,))

    # ---- 主标语 ----
    d.text((70, 190), "手机插电脑", font=F(粗, 94), fill=白 + (255,))
    d.text((70, 302), "一根线全搞定", font=F(粗, 94), fill=白 + (255,))

    # ---- 强调标签（宽度自适应）----
    强调块(d, 70, 440, "不用装 App · 不用 root", F(粗, 42))

    # ---- 一句话介绍 ----
    f介 = F(常, 31)
    d.text((70, 552), "把安卓手机接到电脑上，画面实时上屏，", font=f介, fill=次 + (255,))
    d.text((70, 598), "鼠标、键盘、滚轮直接控制手机。", font=f介, fill=次 + (255,))

    # ---- 功能概览：两列四行 ----
    f项 = F(常, 29)
    f勾 = F(粗, 29)
    功能 = [
        ("实时画面 60 帧", "鼠标键盘直控"),
        ("中文输入", "双栏传文件"),
        ("一键录屏", "ADB 控制台"),
        ("手机当摄像头", "中英双语界面"),
    ]
    for 行, (左, 右) in enumerate(功能):
        y = 700 + 行 * 54
        for 列, 项 in enumerate((左, 右)):
            x = 70 + 列 * 480
            d.text((x, y), "·", font=F(粗, 34), fill=强调 + (255,))
            d.text((x + 26, y), 项, font=f项, fill=次 + (255,))

    # ---- 分割线 ----
    d.line([70, 946, 宽 - 70, 946], fill=(255, 255, 255, 32), width=2)

    # ---- 项目链接（重点）----
    d.text((70, 990), "开源地址", font=F(常, 28), fill=弱 + (255,))
    d.text((70, 1032), "github.com/l-xyzz/Aoid", font=F(粗, 40), fill=强调 + (255,))

    # ---- 三项信息 ----
    信息 = [("平台", "Windows 10 / 11"), ("体积", "免安装 116 MB"), ("许可", "MIT 开源免费")]
    for i, (标签, 值) in enumerate(信息):
        y = 1120 + i * 54
        d.text((70, y), 标签, font=F(常, 28), fill=弱 + (255,))
        d.text((238, y), 值, font=F(粗, 30), fill=白 + (255,))

    # ---- 底部强调线 ----
    d.rounded_rectangle([70, 高 - 76, 宽 - 70, 高 - 72], radius=2, fill=强调 + (255,))

    im.convert("RGB").save(输出, "PNG")
    print("已生成", 输出)


if __name__ == "__main__":
    生成("Z:/项目/xyzz/PhoneDeck/_cards/0-封面.png")
