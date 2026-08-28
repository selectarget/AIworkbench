(() => {
  'use strict';
  if (!/^(?:[^.]+\.)?higgsfield\.ai$/i.test(location.hostname) && !/\.higgsfield\.ai$/i.test(location.hostname)) return;
  if (window.__WORKBENCH_HIGGSFIELD_COURSE__) return;
  window.__WORKBENCH_HIGGSFIELD_COURSE__ = true;
  const intro = 'https://higgsfield.ai/academy/courses/cinema-studio-pro/introduction';
  const setup = 'https://higgsfield.ai/academy/courses/cinema-studio-pro/set-up-your-project';
  if (location.pathname.replace(/\/$/, '') === '/quiz') {
    location.replace(intro);
    return;
  }
  if (/\/academy\/courses\/cinema-studio-pro\/introduction$/i.test(location.pathname)) {
    let attempts = 0;
    const navigateToSetup = () => {
      if (location.pathname.replace(/\/$/, '') !== '/academy/courses/cinema-studio-pro/introduction' || attempts >= 3) return;
      attempts += 1;
      try { location.replace(setup); } catch { /* the page may be closing during a batch-window teardown */ }
      // A blocked or interrupted navigation leaves the page on introduction.
      // Retry a bounded number of times, matching the old helper's reset-on-error behavior.
      setTimeout(navigateToSetup, attempts === 1 ? 1500 : 2500);
    };
    setTimeout(navigateToSetup, 5000);
  }
})();
