import type { DoubaoHistoryCleanupResult } from '../shared/contracts';

export const DOUBAO_HISTORY_URL = 'https://www.doubao.com/chat/thread/list';
export type DoubaoHistoryPageResult = DoubaoHistoryCleanupResult & {
  action?: { kind: 'menu' | 'batch' | 'loaded' | 'all' | 'remove' | 'confirm'; xRatio: number; yRatio: number };
};

export function isDoubaoHistoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.doubao.com', 'doubao.com'].includes(url.hostname)
      && !url.username && !url.password && url.pathname.replace(/\/$/, '') === '/chat/thread/list';
  } catch { return false; }
}

// Runs wholly inside the account's page. Preparation never clicks Delete.
// The delete phase is called only after a native, account-specific confirmation.
async function historyPageAction(phase: 'prepare' | 'delete' | 'verify', token: string, expectedCount: number, timeoutMs: number, nativeInput: boolean): Promise<DoubaoHistoryPageResult> {
  type Marker = { token: string; count: number; createdAt: number; deleting?: boolean; confirmedDialog?: HTMLElement; previousNotifications?: Map<HTMLElement, string> };
  const page = window as Window & { __AIAM_HISTORY_CLEANUP__?: Marker };
  const deadline = Date.now() + timeoutMs;
  const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 150));
  const text = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const action = (kind: NonNullable<DoubaoHistoryPageResult['action']>['kind'], node: HTMLElement): DoubaoHistoryPageResult => {
    const box = node.getBoundingClientRect();
    return { ok: false, count: 0, message: `等待原生页面点击：${kind}`, action: { kind, xRatio: (box.left + box.width / 2) / innerWidth, yRatio: (box.top + box.height / 2) / innerHeight } };
  };
  const visible = (node: Element): boolean => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return node.isConnected && box.width > 0 && box.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  };
  const enabled = (node: Element): boolean => !(node instanceof HTMLButtonElement && node.disabled) && node.getAttribute('aria-disabled') !== 'true';
  const controls = (root: ParentNode = document): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('button,[role="button"],[role="menuitem"],a')).filter((node) => visible(node) && enabled(node));
  const exact = (root: ParentNode, label: string): HTMLElement[] => controls(root).filter((node) => text(node) === label);
  const leafLabels = (pattern: RegExp): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('button,a,span,p,div,h1,h2,h3'))
    .filter((node) => visible(node) && pattern.test(text(node)) && !Array.from(node.children).some((child) => pattern.test(text(child))));
  const footer = (): { root: HTMLElement; count: number; remove: HTMLElement } | null => {
    const counters = leafLabels(/^已选\s*\d+\s*个对话$/).sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    for (const counter of counters) {
      let root: HTMLElement | null = counter.parentElement;
      while (root && root !== document.body) {
        const removes = Array.from(root.querySelectorAll<HTMLElement>('button,[role="button"]')).filter((node) => visible(node) && text(node) === '删除');
        if (removes.length === 1 && exact(root, '取消').length === 1) {
          return { root, count: Number(text(counter).match(/\d+/)?.[0]), remove: removes[0]! };
        }
        root = root.parentElement;
      }
    }
    return null;
  };
  const waitFor = async <T>(read: () => T | null | undefined | false): Promise<T | null> => {
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await sleep();
    }
    return null;
  };
  const fail = (message: string, submitted = false): DoubaoHistoryPageResult => {
    if (phase === 'delete') delete page.__AIAM_HISTORY_CLEANUP__;
    return { ok: false, count: 0, message, submitted };
  };
  if (!['www.doubao.com', 'doubao.com'].includes(location.hostname) || location.pathname.replace(/\/$/, '') !== '/chat/thread/list') {
    return fail('当前不是豆包历史管理页，请先登录豆包');
  }
  const dialogs = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[aria-modal="true"],.arco-modal,.semi-modal'))
    .filter(visible).filter((node, _index, all) => !all.some((other) => other !== node && node.contains(other)));
  if (phase === 'prepare' || phase === 'verify') {
    delete page.__AIAM_HISTORY_CLEANUP__;
    // Doubao's More menu itself uses role=dialog. Allow only the known
    // history menu; account/login/other dialogs still stop preparation.
    if (dialogs().some((node) => exact(node, '批量删除对话').length !== 1)) return fail('请先关闭豆包页面中的弹窗，再清理历史会话');
    let selection = footer();
    if (!selection) {
      const batch = exact(document, '批量删除对话');
      if (batch.length !== 1) {
        const heading = leafLabels(/^管理历史对话$/)[0];
        if (!heading) {
          const loaded = await waitFor(() => leafLabels(/^管理历史对话$/)[0]);
          if (!loaded) return fail('未找到历史管理页面，请检查豆包登录状态');
        }
        const title = leafLabels(/^管理历史对话$/)[0];
        if (!title) return fail('历史管理页面已变化，未执行删除');
        const limit = title.getBoundingClientRect().bottom + 45;
        const menu = await waitFor(() => {
          const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],[aria-haspopup],[data-testid*="more"],[class*="more"],[class*="More"],[class*="dropdown-trigger"]'))
          .filter((node) => {
            if (!(node instanceof HTMLElement) || !visible(node) || !enabled(node)) return false;
            const rect = node.getBoundingClientRect();
            const label = (text(node) || node.getAttribute('aria-label') || node.title).trim();
            return rect.top >= 0 && rect.bottom <= limit && rect.right > innerWidth * 0.65
              && rect.width <= 80 && rect.height <= 80 && (!label || /^(?:更多|更多操作|\.\.\.|…|···|more)$/i.test(label));
          }).filter((node, _index, all) => !all.some((other) => other !== node && node.contains(other)));
          return candidates.length === 1 ? candidates[0] : null;
        });
        if (!menu) return fail('未能唯一识别历史页右上角菜单，请在页面手动进入批量删除');
        if (nativeInput) return action('menu', menu);
        menu.click();
      }
      const batchAction = await waitFor(() => {
        const buttons = exact(document, '批量删除对话');
        return buttons.length === 1 ? buttons[0] : null;
      });
      if (!batchAction) return fail('未找到“批量删除对话”菜单，请在页面手动操作');
      if (nativeInput) return action('batch', batchAction);
      batchAction.click();
      selection = await waitFor(footer);
      if (!selection) return fail('未找到批量删除栏，未执行任何删除');
    }
    // Read the platform's account-wide count, including its hidden label.
    // Main/bot conversations can remain with disabled checkboxes even when
    // every conversation supported by bulk deletion has been removed.
    if (phase === 'verify') {
      let stableSignature = '';
      let stableSince = Date.now();
      const verified = await waitFor(() => {
        const current = footer();
        if (!current) return null;
        const totals = Array.from(current.root.querySelectorAll<HTMLElement>('button,a,span,p,div'))
          .filter((node) => /^选择全部\s*\d+\s*个对话$/.test(text(node))
            && !Array.from(node.children).some((child) => /^选择全部\s*\d+\s*个对话$/.test(text(child))));
        if (totals.length !== 1) return null;
        const total = Number(text(totals[0]!).match(/\d+/)?.[0]);
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="thread_detail_item"]')).filter(visible);
        const signature = `${total}:${current.count}:${rows.length}:${rows.map((row) => enabled(row.querySelector('[role="checkbox"],input[type="checkbox"]') ?? row)).join(',')}`;
        const loading = Array.from(document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')).some(visible);
        if (loading || signature !== stableSignature) { stableSignature = loading ? '' : signature; stableSince = Date.now(); return null; }
        return Number.isSafeInteger(total) && total >= 0 && Date.now() - stableSince >= 1200 ? { current, total } : null;
      });
      if (!verified) return fail('已提交删除，但无法核验平台剩余会话数量；请在页面核对，不会自动重试', true);
      if (verified.total > 0) return fail(`核验后仍有 ${verified.total} 个可清理会话，尚未全部清空；不会自动重试，请在豆包页面核对`, true);
      if (verified.current.count !== 0 || enabled(verified.current.remove)) return fail('平台剩余数量与删除栏状态不一致，请在页面核对；不会自动重试', true);
      const retained = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="thread_detail_item"]')).filter(visible);
      if (retained.some((row) => {
        const checkbox = row.querySelector('[role="checkbox"],input[type="checkbox"]');
        return !checkbox || enabled(checkbox);
      })) return fail('平台显示零个可清理会话，但列表仍有未确认的记录，请在页面核对；不会自动重试', true);
      return { ok: true, count: expectedCount, submitted: true,
        message: retained.length ? '已核验：可批量清理的历史会话已清空；豆包保留的主对话不支持批量删除' : '已核验：可批量清理的历史会话已清空' };
    }
    // Doubao starts with zero selected and hides the account-wide selection
    // link until its footer checkbox selects the currently loaded rows.
    const allLabels = (): HTMLElement[] => Array.from(selection!.root.querySelectorAll<HTMLElement>('button,a,span,p,div'))
      .filter((node) => /^选择全部\s*\d+\s*个对话$/.test(text(node))
        && !Array.from(node.children).some((child) => /^选择全部\s*\d+\s*个对话$/.test(text(child))));
    const initialTotals = allLabels();
    if (initialTotals.length === 1 && Number(text(initialTotals[0]!).match(/\d+/)?.[0]) === 0) {
      return historyPageAction('verify', token, 0, Math.max(1, deadline - Date.now()), nativeInput);
    }
    if (selection.count === 0 || !allLabels().some(visible)) {
      const checkboxes = Array.from(selection.root.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')).filter((node) => visible(node) && enabled(node));
      if (checkboxes.length !== 1) return fail('无法唯一识别批量栏的全选复选框，未执行删除');
      const checkbox = checkboxes[0]!;
      const checked = checkbox instanceof HTMLInputElement ? checkbox.checked && !checkbox.indeterminate : checkbox.getAttribute('aria-checked') === 'true';
      if (!checked) {
        if (nativeInput) return action('loaded', checkbox);
        checkbox.click();
      }
      const loaded = await waitFor(() => { const current = footer(); return current && current.count > 0 ? current : null; });
      if (!loaded) return fail('没有选中可清理会话，请等待历史列表加载后重试；未执行删除');
      selection = loaded;
    }
    const labels = await waitFor(() => { const current = allLabels(); return current.length === 1 ? current : null; });
    if (!labels) return fail('无法核对全部会话数量，请在豆包页面检查，未执行删除');
    const count = Number(text(labels[0]!).match(/\d+/)?.[0]);
    if (!Number.isSafeInteger(count) || count < 1) return fail('没有可清理的历史会话');
    if (selection.count !== count) {
      const allAction = await waitFor(() => { const current = allLabels().filter(visible); return current.length === 1 && enabled(current[0]!) ? current[0] : null; });
      if (!allAction) return fail('当前仅选中了部分会话，但全量选择入口不可用，未执行删除');
      if (nativeInput) return action('all', allAction);
      allAction.click();
    }
    const selected = await waitFor(() => { const current = footer(); return current?.count === count ? current : null; });
    if (!selected) return fail('全选后的会话数量不一致，未执行删除');
    page.__AIAM_HISTORY_CLEANUP__ = { token, count, createdAt: Date.now() };
    return { ok: true, count, message: `已选中全部 ${count} 个会话，等待确认` };
  }
  const marker = page.__AIAM_HISTORY_CLEANUP__;
  const selected = footer();
  if (!marker || marker.token !== token || marker.count !== expectedCount || Date.now() - marker.createdAt > 5 * 60_000
    || expectedCount < 1 || (!marker.deleting && (!selected || selected.count !== expectedCount || dialogs().length))) {
    return fail('页面或选中会话已变化，请重新核对后再清理；未执行删除');
  }
  const notifications = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="status"],[role="alert"],.arco-message,.semi-toast,[class*="toast"]')).filter(visible);
  if (!marker.deleting) {
    if (!selected || !enabled(selected.remove)) return fail('豆包删除按钮尚不可用，未执行删除');
    marker.previousNotifications = new Map(notifications().map((node) => [node, text(node)]));
    marker.deleting = true;
    if (nativeInput) return action('remove', selected.remove);
    selected.remove.click();
  }
  const previousNotifications = marker.previousNotifications!;
  let confirmedDialog: HTMLElement | null = marker.confirmedDialog ?? null;
  while (Date.now() < deadline) {
    const opened = dialogs();
    if (opened.length) {
      if (opened.length !== 1 || (confirmedDialog && opened[0] !== confirmedDialog)) return fail('删除流程出现额外弹窗，请在豆包页面核对', true);
      if (confirmedDialog) { await sleep(); continue; }
      const dialog = opened[0]!;
      const content = text(dialog);
      const dialogCount = content.match(/(\d+)\s*个对话/);
      if (!/删除/.test(content) || !/对话/.test(content) || /注销|删除账号/.test(content) || (dialogCount && Number(dialogCount[1]) !== expectedCount)) {
        return fail('豆包确认弹窗与待清理会话不一致，已停止，请在页面核对', true);
      }
      const confirmButtons = controls(dialog).filter((node) => /^(?:删除|确认删除|确定删除|确定|确认)$/.test(text(node)));
      if (confirmButtons.length !== 1) return fail('无法唯一识别豆包删除确认按钮，请在页面核对', true);
      confirmedDialog = dialog;
      marker.confirmedDialog = dialog;
      if (nativeInput) return action('confirm', confirmButtons[0]!);
      confirmButtons[0]!.click();
      // Let the native dialog unmount before inspecting the next state.
      await sleep();
      continue;
    }
    const currentNotifications = notifications().filter((node) => previousNotifications.get(node) !== text(node));
    const error = currentNotifications.find((node) => /删除失败|操作失败|请求失败|网络错误|操作频繁/.test(text(node)));
    if (error) return fail('豆包未完成删除：' + text(error).slice(0, 160), true);
    if (currentNotifications.some((node) => /删除成功|成功删除/.test(text(node))) || (!footer() && leafLabels(/^(?:暂无(?:历史)?对话|暂无聊天记录|还没有对话|没有历史对话)$/).length)) {
      delete page.__AIAM_HISTORY_CLEANUP__;
      return { ok: true, count: expectedCount, submitted: true, message: `豆包已确认删除 ${expectedCount} 个历史会话` };
    }
    await sleep();
  }
  return fail('已提交删除操作，豆包页面尚未确认结果，请在页面核对；不会自动重试', true);
}

export function buildDoubaoHistoryScript(phase: 'prepare' | 'delete' | 'verify', token: string, count = 0, timeoutMs = 15_000, nativeInput = false): string {
  return `(${historyPageAction.toString()})(${JSON.stringify(phase)}, ${JSON.stringify(token)}, ${JSON.stringify(count)}, ${JSON.stringify(timeoutMs)}, ${JSON.stringify(nativeInput)})`;
}
