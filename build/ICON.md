# Serphia 图标

标志以欧拉螺线为骨架。中心的笔画舒展，两端逐渐收紧、变细，勾出介于 Serphia 首字母 S 与积分号 ∫ 之间的轮廓。
两端绕画布中心旋转 180° 后重合，整枚标志由一条闭合路径构成。

桌面图标使用墨绿底色（`#163C34`）与暖象牙白笔画（`#F8F2DE`）。侧栏中的标志跟随文字颜色，macOS 菜单栏使用透明底的单色模板。

## 更新图标

编辑 `build/mark.svg` 中的贝塞尔路径后，运行 `npm run build:icons` 重新生成以下资源。

- `icon.svg` 是带圆角底板的矢量图，也用作浏览器标签页图标。
- `icon.png` 是 1024 × 1024 的透明底 PNG，供 README 与 Dock 使用。
- `icon.ico` 和 `icon.icns` 分别用于 Windows 和 macOS 打包。
- `icons/` 包含 16 至 1024 像素的 PNG，供 Linux 打包使用。
- `trayTemplate.png` 和 `trayTemplate@2x.png` 是 macOS 菜单栏的 18 和 36 像素模板。
