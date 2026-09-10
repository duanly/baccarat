# 荷官形象素材

把两张透明底 PNG（或 WebP）放到这里即可替换默认的矢量荷官，无需改代码：

- `idle.png` — 待机姿势（正对镜头，双手在桌面）
- `deal.png` — 出牌姿势（右手伸向牌靴 / 推牌）

建议尺寸 900×700 左右、人物居中、下沿贴底（腰部以下被桌面挡住）。
出牌时页面会在两张图间切换约 0.65 秒。若想要连续动画，可换成一段透明背景的 WebM（VP9 alpha）/ 带 alpha 的 HEVC MOV（iOS），
把 `DealerScene.tsx` 里的 `<img>` 换成 `<video autoPlay loop muted playsInline>` 即可。
