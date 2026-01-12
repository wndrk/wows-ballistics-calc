// Physics constants (from jcw780/wows_shell)
export const PHYSICS = {
  g: 9.81,              // gravity (m/s^2)
  t0: 288.15,           // sea level temperature (K)
  L: 0.0065,            // temperature lapse rate (K/m)
  p0: 101325,           // sea level pressure (Pa)
  M: 0.0289644,         // molar mass of air (kg/mol)
  R: 8.31447,           // gas constant (J/(mol*K))
  timeMultiplier: 2.75, // WoWS game time scaling factor
};
PHYSICS.gMRL = (PHYSICS.g * PHYSICS.M) / (PHYSICS.R * PHYSICS.L);

// Range modifiers
export const MODIFIERS = {
  aftMultiplier: 1.2,       // AFT skill bonus for destroyers (+20%)
  spotterMultiplier: 1.2,   // Spotter plane bonus for BBs/CAs/CBs/CLs (+20%)
  aprm1Multiplier: 1.16,    // Artillery Plotting Room Mod 1 for USN BBs (+16%)
  rangeBufferKm: 0.5,       // Buffer added to max range in XML output (km)
  uniqueUpgrades: {
    'Henri IV': 1.05,       // Unique upgrade: +5% max range
  },
};

// Pitch values for config generation (matching old scraper)
export const PITCH = {
  ap: {
    DD: 0,
    BB: -0.014,
    default: -0.013
  },
  other: {  // HE/SAP
    DD: 0.03,
    default: 0.05  // Used for all non-DD including BB
  },
  // Ship-specific overrides: { shipName: { shellType: pitchValue } }
  shipOverrides: {
    'Cristoforo Colombo': { sap: 0.045 }
  }
};

// Ship name mappings for config output
export const SHIP_NAME_MAPPINGS = {
  // Suffix transformations: { suffix, prefix, trim }
  suffixes: [
    { suffix: ' B', prefix: 'Black_', trim: 2 },      // "Rhode Island B" -> "Black_Rhode_Island"
    { suffix: ' Golden', prefix: 'Gold_', trim: 7 },  // "Aki Golden" -> "Gold_Aki"
  ],
  // Exact name replacements
  exact: {
    'Alexander Nevsky': 'Pr_84_Alexander_Nevsky',
    'Yueyang': 'Hsiang_Yang',
    'Zao': 'Zao_1944',
    'Zorkiy': 'Zorky',
    'Kremlin': 'Sovetskaya_Rossiya',
    'Moskva': 'Pr_66_Moskva',
  },
};

// Scraping URLs
export const URLS = {
  base: 'https://shiptool.st',
  params: '/params',           // Ship names, classes, max ranges
  consumables: '/params?p=con', // Spotter plane availability
  shells: {
    ap: '/params?p=ap',        // AP shell data
    he: '/params?p=he',        // HE shell data
    sap: '/params?p=sap',      // SAP shell data
  }
};

// Ship classes to skip
export const SKIP_CLASSES = ['SS', 'CV'];
