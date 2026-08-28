# 人脸网格模型

这是旧版 `FaceGridToolWindow` 使用的 OpenCV DNN SSD 人脸检测模型。工作台在渲染进程中使用包含 DNN 模块的 OpenCV.js WASM 构建的 Caffe 读取接口执行检测，主进程只负责选择文件、提供模型字节和原子保存结果。

- `deploy.prototxt`：网络结构
- `res10_300x300_ssd_iter_140000.caffemodel`：权重
- 模型最大输入边会按旧版限制缩放到 2500 像素；检测阈值和 NMS 阈值为 0.3。
- 处理只生成网格/脸部重组图，不执行人脸识别、身份推断或云端上传。
- OpenCV.js 依赖的许可证见 `licenses/opencv-js-Apache-2.0.txt`；发布前应核对模型原始分发条款。
