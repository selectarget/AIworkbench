import type { PlatformDefinition, PlatformId } from './contracts';

export const platforms: Record<PlatformId, PlatformDefinition> = {
  doubao: { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat', specialized: true },
  qianwen: { id: 'qianwen', name: '千问', url: 'https://www.qianwen.com/', specialized: true },
  dola: { id: 'dola', name: 'Dola', url: 'https://www.dola.com/', specialized: true },
  yunque: { id: 'yunque', name: '云雀', url: 'https://xyq.jianying.com/', specialized: true },
  higgsfield: { id: 'higgsfield', name: 'Higgsfield', url: 'https://higgsfield.ai/academy/courses/cinema-studio-pro/set-up-your-project', specialized: true },
  kimi: { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', specialized: false },
  oiioii: { id: 'oiioii', name: 'oiioii', url: 'https://www.oiioii.ai/home', specialized: false },
  nano: { id: 'nano', name: 'nano', url: 'https://xcgai.cn/', specialized: false },
  lovart: { id: 'lovart', name: 'Lovart', url: 'https://www.lovart.ai/zh/home', specialized: false },
  jimeng: { id: 'jimeng', name: '即梦', url: 'https://jimeng.jianying.com/ai-tool/asset', specialized: true },
  custom: { id: 'custom', name: '自定义网站', url: '', specialized: false }
};
