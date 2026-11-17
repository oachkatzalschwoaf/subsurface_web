/**
 * Help page (help.html): shows one language, lists the sections and filters them by the search
 * field. The language follows the app's choice on this device (same storage key as lib/i18n.ts),
 * otherwise the system language, otherwise English; the button switches it for this page only.
 */
import './help.css';

type Lang = 'en' | 'de';
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'de';

function startLang(): Lang {
  try {
    const stored = localStorage.getItem('topside.lang');
    if (isLang(stored)) return stored;
  } catch {
    // storage blocked
  }
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

const TEXT: Record<Lang, { search: string; other: string; otherLabel: string; title: string }> = {
  en: { search: 'Search help', other: 'DE', otherLabel: 'Deutsch', title: 'Help' },
  de: { search: 'Hilfe durchsuchen', other: 'EN', otherLabel: 'English', title: 'Hilfe' },
};

const search = document.getElementById('search') as HTMLInputElement;
const langButton = document.getElementById('lang') as HTMLButtonElement;
const contents = document.getElementById('contents')!;
const none = document.getElementById('none')!;
const sections = [...document.querySelectorAll<HTMLElement>('main > section')];
const appName = document.title.replace(/ – Help$/, '');
let lang = startLang();

/** The article of a section in the current language. */
const articleOf = (section: HTMLElement) => section.querySelector<HTMLElement>(`article[lang="${lang}"]`);

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  document.title = `${appName} – ${TEXT[lang].title}`;
  search.placeholder = TEXT[lang].search;
  search.setAttribute('aria-label', TEXT[lang].search);
  langButton.textContent = TEXT[lang].other;
  langButton.setAttribute('aria-label', TEXT[lang].otherLabel);
  filter();
}

/** Shows the sections whose text holds every word of the search, and lists them as contents. */
function filter() {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const links: HTMLElement[] = [];
  for (const section of sections) {
    const article = articleOf(section);
    const text = article?.textContent?.toLowerCase() ?? '';
    const match = words.every((w) => text.includes(w));
    section.hidden = !match;
    if (!match || !article) continue;
    const link = document.createElement('a');
    link.href = `#${section.id}`;
    link.textContent = article.querySelector('h2')?.textContent ?? section.id;
    links.push(link);
  }
  contents.replaceChildren(...links);
  none.hidden = links.length > 0;
}

search.addEventListener('input', filter);
langButton.addEventListener('click', () => {
  lang = lang === 'de' ? 'en' : 'de';
  apply();
});

apply();
// The other language's text was in the layout while the browser jumped to the anchor: jump again.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
