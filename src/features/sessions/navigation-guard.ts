// Only live page state is read. No history sentinels, router patches or private storage.
export function installNavigationGuard(
  readRisks: () => string[],
  blocked: (risks: string[]) => void,
) {
  let clickDecision: boolean | null = null;
  let reset: ReturnType<typeof setTimeout> | undefined;
  let editor: HTMLElement | null = null;
  const focus = (event: FocusEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
      editor = event.target;
  };
  const cancel = (risks: string[]) => {
    blocked(risks);
    if (editor?.isConnected) editor.focus({ preventScroll: true });
  };
  const ask = (risks: string[]) => {
    try {
      return window.confirm(`当前页面还有：${risks.join('、')}。\n未保存内容与本页的待核对信息离开后不保证恢复。已提交请求可能仍在处理。\n仍要离开吗？此操作不会发送或重试模型内容。`);
    } catch {
      return false;
    }
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const to = new URL(anchor.href, location.href), from = new URL(location.href);
    if (to.origin !== from.origin || (to.pathname === from.pathname && to.search === from.search && to.hash !== from.hash)) return;
    const risks = readRisks();
    if (!risks.length) return;
    clickDecision = ask(risks);
    if (reset !== undefined) clearTimeout(reset);
    reset = setTimeout(() => { clickDecision = null; }, 0);
    if (!clickDecision) { event.preventDefault(); cancel(risks); }
  };
  // Existing AppShell/Workspace/feedback links preflight here during the same click.
  // Other callers of the legacy event continue to fail closed instead of bypassing it.
  const legacy = (event: Event) => {
    const risks = readRisks();
    if (risks.length && clickDecision !== true) { event.preventDefault(); cancel(risks); }
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (readRisks().length) { event.preventDefault(); event.returnValue = ''; }
  };
  const traverse = (event: NavigateEvent) => {
    // Intercept before a same-document history traversal commits. Cancelling popstate
    // is too late. Cross-document departures rely on the browser's beforeunload UI.
    // Do not cancel pushState/replaceState after App Router has already updated React.
    if (event.navigationType !== 'traverse' || !event.destination.sameDocument || !event.canIntercept || !event.cancelable) return;
    const risks = readRisks();
    if (risks.length && !ask(risks)) { event.preventDefault(); cancel(risks); }
  };
  const navigation = 'navigation' in window ? window.navigation : undefined;
  document.addEventListener('click', click, true);
  document.addEventListener('focusin', focus);
  window.addEventListener('algopilot-before-navigate', legacy);
  window.addEventListener('beforeunload', unload);
  navigation?.addEventListener('navigate', traverse);
  return () => {
    document.removeEventListener('click', click, true);
    document.removeEventListener('focusin', focus);
    window.removeEventListener('algopilot-before-navigate', legacy);
    window.removeEventListener('beforeunload', unload);
    navigation?.removeEventListener('navigate', traverse);
    if (reset !== undefined) clearTimeout(reset);
  };
}
