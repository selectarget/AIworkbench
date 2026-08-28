import type { WorkbenchApi } from '../../shared/contracts';
declare module 'opencv-js-wasm/opencv.js' { const cv: unknown; export default cv; }
declare global { interface Window { workbench: WorkbenchApi } }
export {};
