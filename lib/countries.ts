// Country → subreddit mapping.
// Chosen for: country-relevance signal, public/active status, English or model-supported language.
// We are HONEST about bias — no subreddit is "the country." See methodology in UI.

export interface Country {
  code: string;
  name: string;
  flag: string;
  // Subreddits searched within this country's context.
  // First 2 are highest-priority (general national subs); rest add diversity.
  subreddits: string[];
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', flag: '🇮🇳', subreddits: ['india', 'IndiaSpeaks', 'AskIndia', 'unitedstatesofindia', 'IndianEnterprise'] },
  { code: 'US', name: 'United States', flag: '🇺🇸', subreddits: ['AskAnAmerican', 'politics', 'news', 'Conservative', 'Economics'] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', subreddits: ['unitedkingdom', 'AskUK', 'ukpolitics', 'CasualUK'] },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', subreddits: ['canada', 'CanadaPolitics', 'AskACanadian', 'onguardforthee'] },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', subreddits: ['australia', 'AskAnAustralian', 'AustralianPolitics'] },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', subreddits: ['germany', 'de', 'AskAGerman', 'Finanzen'] },
  { code: 'FR', name: 'France', flag: '🇫🇷', subreddits: ['france', 'AskFrance', 'rance'] },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', subreddits: ['brasil', 'brasilivre', 'investimentos'] },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', subreddits: ['japan', 'japanlife', 'newsokur'] },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', subreddits: ['korea', 'hanguk'] },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', subreddits: ['mexico', 'MexicoCity', 'MexicoFinanciero'] },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', subreddits: ['italy', 'ItalyInformatica'] },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', subreddits: ['spain', 'es'] },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', subreddits: ['thenetherlands', 'Netherlands'] },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', subreddits: ['sweden', 'svenskpolitik'] },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', subreddits: ['poland', 'Polska'] },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', subreddits: ['turkey', 'Turkiye'] },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', subreddits: ['indonesia', 'indonesian'] },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', subreddits: ['Philippines', 'AskPH'] },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', subreddits: ['pakistan'] },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', subreddits: ['bangladesh', 'dhaka'] },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', subreddits: ['Nigeria'] },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', subreddits: ['southafrica'] },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', subreddits: ['Egypt'] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', subreddits: ['dubai', 'UAE'] },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', subreddits: ['singapore', 'askSingapore'] },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', subreddits: ['argentina'] },
  { code: 'IL', name: 'Israel', flag: '🇮🇱', subreddits: ['Israel'] },
];

export function findCountry(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code);
}
