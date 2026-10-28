"""生成抖音图文卡片（优化版）。

改进点：
  1. 截图先裁掉四周的窗口边框和空白，让内容占更大面积
  2. 增加一张封面图（不讲细节，只抛钩子）
  3. 截图加轻微投影，和背景拉开层次
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

宽, 高 = 1080, 1440

底 = (11, 13, 16)
底2 = (23, 27, 33)
强调 = (245, 165, 36)
白 = (255, 255, 255)
次 = (170, 178, 190)
弱 = (120, 128, 140)

字体粗 = "C:/Windows/Fonts/msyhbd.ttc"
字体常 = "C:/Windows/Fonts/msyh.ttc"


def 载字体(路径, 大小):
    return ImageFont.truetype(路径, 大小)


def 新画布():
    画布 = Image.new("RGBA", (宽, 高), 底 + (255,))
    光 = Image.new("RGBA", (宽, 高), (0, 0, 0, 0))
    d = ImageDraw.Draw(光)
    d.ellipse([-320, -540, 宽 + 320, 280], fill=(245, 165, 36, 28))
    光 = 光.filter(ImageFilter.GaussianBlur(140))
    画布.alpha_composite(光)
    return 画布


def 圆角图(图, 圆角):
    mask = Image.new("L", 图.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 图.size[0], 图.size[1]], radius=圆角, fill=255)
    结果 = Image.new("RGBA", 图.size, (0, 0, 0, 0))
    结果.paste(图, (0, 0), mask)
    return 结果


def 裁边(图路径, 边=(6, 30, 6, 6)):
    """裁掉截图四周多余的窗口边框 / 空白

    参数 边 = (左, 上, 右, 下)，按原图像素算。
    """
    im = Image.open(图路径).convert("RGB")
    l, t, r, b = 边
    return im.crop((l, t, im.width - r, im.height - b))


def 贴图(画布, 图, 框, 圆角=14):
    x0, y0, x1, y1 = 框
    框宽, 框高 = x1 - x0, y1 - y0

    缩放 = min(框宽 / 图.width, 框高 / 图.height)
    新尺寸 = (int(图.width * 缩放), int(图.height * 缩放))
    缩图 = 图.resize(新尺寸, Image.LANCZOS)

    贴x = x0 + (框宽 - 新尺寸[0]) // 2
    贴y = y0 + (框高 - 新尺寸[1]) // 2

    # 阴影层
    影 = Image.new("RGBA", 画布.size, (0, 0, 0, 0))
    ImageDraw.Draw(影).rounded_rectangle(
        [贴x, 贴y + 12, 贴x + 新尺寸[0], 贴y + 新尺寸[1] + 16],
        radius=圆角,
        fill=(0, 0, 0, 190),
    )
    画布.alpha_composite(影.filter(ImageFilter.GaussianBlur(34)))

    # 边框 + 图
    边 = Image.new("RGBA", (新尺寸[0] + 4, 新尺寸[1] + 4), (0, 0, 0, 0))
    ImageDraw.Draw(边).rounded_rectangle(
        [0, 0, 边.width - 1, 边.height - 1], radius=圆角 + 2, outline=强调 + (110,), width=2
    )
    边.alpha_composite(圆角图(缩图.convert("RGBA"), 圆角), (2, 2))
    画布.alpha_composite(边, (贴x - 2, 贴y - 2))


def 顶部(画布, 主标题, 副标题, 主标题字号=66):
    d = ImageDraw.Draw(画布)
    d.rounded_rectangle([70, 94, 92, 116], radius=5, fill=强调 + (255,))
    d.text((112, 80), "Aoid", font=载字体(字体粗, 32), fill=强调 + (255,))
    d.text((宽 - 200, 98), "v1.0.0", font=载字体(字体常, 26), fill=弱 + (255,))

    d.text((70, 158), 主标题, font=载字体(字体粗, 主标题字号), fill=白 + (255,))
    d.text((70, 158 + 主标题字号 + 26), 副标题, font=载字体(字体常, 31), fill=次 + (255,))


def 底部要点(画布, 行们):
    d = ImageDraw.Draw(画布)
    y = 高 - 56 - len(行们) * 56
    for 文本 in 行们:
        d.text((74, y), "·", font=载字体(字体粗, 34), fill=强调 + (255,))
        d.text((106, y), 文本, font=载字体(字体常, 34), fill=次 + (255,))
        y += 56


def 生成(输出名, 主标题, 副标题, 图, 要点们, 裁边参数=(6, 30, 6, 6)):
    画布 = 新画布()
    顶部(画布, 主标题, 副标题)

    裁后 = 裁边(图, 裁边参数)
    框 = (70, 330, 宽 - 70, 高 - 96 - len(要点们) * 56 - 46)
    贴图(画布, 裁后, 框)
    底部要点(画布, 要点们)

    画布.convert("RGB").save(输出名, "PNG")
    print("已生成", os.path.basename(输出名))


def 生成封面(输出名):
    """封面：不展示界面，只抛钩子 + 一根数据线的意象"""
    画布 = 新画布()
    d = ImageDraw.Draw(画布)

    大标题 = 载字体(字体粗, 96)
    中标题 = 载字体(字体粗, 52)
    小标题 = 载字体(字体常, 36)

    # 顶部小标记
    d.rounded_rectangle([70, 110, 92, 132], radius=5, fill=强调 + (255,))
    d.text((112, 96), "Aoid 1.0.0", font=载字体(字体粗, 34), fill=强调 + (255,))

    # 主标语
    d.text((70, 430), "手机插电脑", font=大标题, fill=白 + (255,))
    d.text((70, 550), "能干什么？", font=大标题, fill=白 + (255,))

    # 强调块
    d.rounded_rectangle([70, 730, 70 + 560, 810], radius=12, fill=强调 + (255,))
    d.text((100, 745), "不用装 App 不用 root", font=中标题, fill=(16, 16, 20, 255))

    # 说明
    d.text((70, 880), "一根数据线，把手机接到电脑上", font=小标题, fill=次 + (255,))
    d.text((70, 936), "鼠标点、键盘打，全是真的", font=小标题, fill=次 + (255,))

    # 底部信息条
    d.line([70, 高 - 250, 宽 - 70, 高 - 250], fill=(255, 255, 255, 26), width=2)

    for i, (标签, 值) in enumerate(
        [("平台", "Windows 10 / 11"), ("体积", "免安装 116 MB"), ("许可", "MIT 开源免费")]
    ):
        y = 高 - 200 + i * 58
        d.text((70, y), 标签, font=载字体(字体常, 30), fill=弱 + (255,))
        d.text((300, y), 值, font=载字体(字体粗, 30), fill=白 + (255,))

    画布.convert("RGB").save(输出名, "PNG")
    print("已生成", os.path.basename(输出名))


if __name__ == "__main__":
    截图 = "Z:/项目/xyzz/PhoneDeck/_shot"
    输出 = "Z:/项目/xyzz/PhoneDeck/_cards"
    os.makedirs(输出, exist_ok=True)

    生成封面(f"{输出}/0-封面.png")

    生成(
        f"{输出}/1-主界面.png",
        "手机插电脑，直接用",
        "画面实时上屏，鼠标键盘全接管",
        f"{截图}/01-主界面.png",
        ["不用装 App，不用 root", "60 帧实时画面，延迟无感", "中文输入、音量亮度双向同步"],
        (2, 2, 2, 2),
    )

    生成(
        f"{输出}/2-文件管理.png",
        "传文件不用微信了",
        "左边手机，右边电脑，点一下就过去",
        f"{截图}/03-文件管理.png",
        ["双栏对照，两边同时看清", "记住上次位置，切盘随时换", "整个磁盘都能访问"],
        (4, 30, 4, 4),
    )

    生成(
        f"{输出}/3-ADB控制台.png",
        "自带 ADB 控制台",
        "命令行玩家会喜欢的东西",
        f"{截图}/04-ADB控制台.png",
        ["Tab 补全，命令历史上下翻", "语法高亮，输出可选中复制", "响应 200ms 以内"],
        (4, 30, 4, 4),
    )

    生成(
        f"{输出}/4-应用管理.png",
        "手机上有什么，全在这",
        "应用、进程，一个窗口管完",
        f"{截图}/02-更多功能.png",
        ["应用列表带系统标记", "一键启动、停止、卸载", "直接装电脑上的 APK"],
        (4, 30, 4, 4),
    )

    print("\n全部完成")
