const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT
MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG
UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`
  .trim()
  .split(/\s+/);

function createDisplayNames(type) {
  try {
    return new Intl.DisplayNames(['en'], { type });
  } catch {
    return null;
  }
}

function supportedValuesOf(key) {
  try {
    return Intl.supportedValuesOf(key);
  } catch {
    return [];
  }
}

const regionNames = createDisplayNames('region');
const currencyNames = createDisplayNames('currency');

export const INDUSTRY_OPTIONS = Object.freeze([
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale and distribution' },
  { value: 'food-beverage', label: 'Food and beverage' },
  { value: 'fashion', label: 'Fashion and apparel' },
  { value: 'electronics', label: 'Electronics and technology' },
  { value: 'health-beauty', label: 'Health and beauty' },
  { value: 'home-garden', label: 'Home and garden' },
  { value: 'services', label: 'Professional services' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'logistics', label: 'Logistics and delivery' },
  { value: 'hospitality', label: 'Hospitality and travel' },
  { value: 'education', label: 'Education and training' },
  { value: 'other', label: 'Other' },
]);

export const COUNTRY_OPTIONS = Object.freeze(
  COUNTRY_CODES.map((code) => ({
    value: code,
    label: regionNames?.of(code) ?? code,
  })).sort((a, b) => a.label.localeCompare(b.label)),
);

const FALLBACK_CURRENCIES = [
  'AED',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'DKK',
  'EUR',
  'GBP',
  'GHS',
  'INR',
  'JPY',
  'KES',
  'MXN',
  'NGN',
  'NOK',
  'PLN',
  'RWF',
  'SAR',
  'SEK',
  'TRY',
  'TZS',
  'UGX',
  'USD',
  'XAF',
  'XOF',
  'ZAR',
];

const currencyCodes = supportedValuesOf('currency');
const resolvedCurrencies = currencyCodes.length ? currencyCodes : FALLBACK_CURRENCIES;

export const CURRENCY_OPTIONS = Object.freeze(
  resolvedCurrencies
    .map((code) => {
      const name = currencyNames?.of(code);
      return {
        value: code,
        label: name && name !== code ? `${code} — ${name}` : code,
      };
    })
    .sort((a, b) => a.value.localeCompare(b.value)),
);

const FALLBACK_TIMEZONES = [
  'Africa/Abidjan',
  'Africa/Accra',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Kigali',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Pacific/Auckland',
  'UTC',
];

const timezoneValues = supportedValuesOf('timeZone');
const resolvedTimezones = timezoneValues.length ? timezoneValues : FALLBACK_TIMEZONES;

export const TIMEZONE_OPTIONS = Object.freeze(
  resolvedTimezones.map((value) => ({
    value,
    label: value.replace(/_/g, ' '),
  })),
);

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
