/* The customer's page follows the phone: light or dark, also when it changes while the page is open, and always light
   on paper. (client.html sets the first mode before anything is drawn, so there is no white flash at night.) */

/** the phone's light or dark, also when it changes while the page is open */
export function followScheme() {
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    // the customer sees the garage's own look: H.I.S, its picture behind the glass
    document.documentElement.dataset.theme = 'his';
    const set = () => {
      document.documentElement.dataset.mode = mq.matches ? 'dark' : 'light';
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) meta.content = mq.matches ? '#000000' : '#E7EAEE';
    };
    set();
    mq.addEventListener?.('change', set);
    // paper is white: a dark phone prints with the light inks (the dark ones are light grey, unreadable on paper)
    window.addEventListener('beforeprint', () => { document.documentElement.dataset.mode = 'light'; });
    window.addEventListener('afterprint', set);
  } catch { /* old browser: light */ }
}
