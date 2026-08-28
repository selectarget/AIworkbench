const repo = process.env.GITHUB_RELEASE_REPO || '';
const key = process.env.UPDATE_PUBLIC_KEY || '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('正式发布必须设置 GITHUB_RELEASE_REPO=owner/repo');
if (!key.includes('PUBLIC KEY')) throw new Error('正式发布必须设置 UPDATE_PUBLIC_KEY');
console.log(`release configuration ok: ${repo}`);
