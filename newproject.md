# New Project: WoWS Ballistics Calculator

## Project Overview
A Node.js tool that calculates World of Warships shell ballistics (flight time, impact angle) using physics simulation instead of scraping pre-computed values.

## Goal
Calculate accurate BulletSpeed factors for weapon configs by solving the ballistic trajectory equations directly, given shell properties from shiptool.st.

## Input Data (from shiptool.st)

### Shell Properties (per ship, per shell type)
- `muzzleVelocity` (m/s) - Initial speed (e.g., 960 m/s)
- `mass` (kg) - Shell weight (e.g., 46 kg)
- `dragCoefficient` (unitless) - Drag coeff (e.g., 0.290)
- `caliber` (mm) - Shell diameter (e.g., 150 mm)

### Ship Data (from /params table)
- `name` - Ship name
- `class` - Ship class (BB, CA, CB, CL, DD, SS, CV)
- `maxRange` - Base firing range (km)

### Consumables (from /params?p=con table)
- `hasSpotter` - Whether ship has spotter plane (check if spotter column has a number > 0)

## Range Modifiers

### Config
```javascript
const MODIFIERS = {
  aftMultiplier: 1.2,       // AFT skill bonus for destroyers (+20%)
  spotterMultiplier: 1.2,   // Spotter plane bonus for BBs/CAs/CBs/CLs (+20%)
  rangeBuffer: 1.05,        // Universal buffer applied to all ships (+5%)
  uniqueUpgrades: {
    'Henri IV': 1.05,       // Unique upgrade: +5% max range
  },
};
```

### Application Logic
```javascript
function calculateModifiedRange(baseMaxRange, shipClass, hasSpotter, shipName) {
  let maxRange = baseMaxRange;

  // Apply class-specific modifiers
  if (shipClass === 'DD') {
    // All destroyers get AFT (+20%)
    maxRange = baseMaxRange * MODIFIERS.aftMultiplier;
  } else if (['BB', 'CA', 'CB', 'CL'].includes(shipClass) && hasSpotter) {
    // BBs/CAs/CBs/CLs with spotter plane (+20%)
    maxRange = baseMaxRange * MODIFIERS.spotterMultiplier;
  }

  // Apply unique upgrade modifier if applicable
  const uniqueMultiplier = MODIFIERS.uniqueUpgrades[shipName];
  if (uniqueMultiplier) {
    maxRange *= uniqueMultiplier;
  }

  // Apply universal range buffer (+5%)
  maxRange *= MODIFIERS.rangeBuffer;

  return maxRange;
}
```

### Skip Classes
- `SS` (Submarines) - Don't need configs
- `CV` (Carriers) - Don't need configs

## Ship Name Mappings

### Name Normalization
```javascript
const SHIP_NAME_MAPPINGS = {
  // Suffix transformations: { suffix, prefix, trim }
  suffixes: [
    { suffix: ' B', prefix: 'Black_', trim: 2 },      // "Rhode Island B" → "Black_Rhode_Island"
    { suffix: ' Golden', prefix: 'Gold_', trim: 7 },  // "Aki Golden" → "Gold_Aki"
  ],
  // Exact name replacements
  exact: {
    'Yueyang': 'Hsiang_Yang',
    'Zao': 'Zao_1944',
    'Zorkiy': 'Zorky',
  },
};

function normalizeShipName(name) {
  let weaponName = String(name).trim();

  // Apply suffix transformations (Black, Golden variants)
  for (const { suffix, prefix, trim } of SHIP_NAME_MAPPINGS.suffixes) {
    if (weaponName.endsWith(suffix)) {
      weaponName = prefix + weaponName.slice(0, -trim);
      break;
    }
  }

  // Apply exact name replacements
  if (SHIP_NAME_MAPPINGS.exact[weaponName]) {
    weaponName = SHIP_NAME_MAPPINGS.exact[weaponName];
  }

  // Remove diacritics (í→i, é→e, etc.)
  weaponName = weaponName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Replace special chars: ' → _, . → removed, - → _, spaces → _
  weaponName = weaponName
    .replace(/'/g, '_')
    .replace(/\./g, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');

  return weaponName;
}
```

## Physics Model (from jcw780/wows_shell)

### Constants
```javascript
const PHYSICS = {
  g: 9.81,              // gravity (m/s²)
  t0: 288.15,           // sea level temperature (K)
  L: 0.0065,            // temperature lapse rate (K/m)
  p0: 101325,           // sea level pressure (Pa)
  M: 0.0289644,         // molar mass of air (kg/mol)
  R: 8.31447,           // gas constant (J/(mol·K))
  timeMultiplier: 2.75, // WoWS game time scaling factor
};
PHYSICS.gMRL = (PHYSICS.g * PHYSICS.M) / (PHYSICS.R * PHYSICS.L);
```

### Atmospheric Model (air density varies with altitude)
```javascript
function getAirDensity(y) {
  const T = PHYSICS.t0 - PHYSICS.L * y;                           // temperature at altitude
  const p = PHYSICS.p0 * Math.pow(T / PHYSICS.t0, PHYSICS.gMRL);  // pressure
  const rho = (p * PHYSICS.M) / (PHYSICS.R * T);                  // air density
  return rho;
}
```

### Combined Drag Factor
```javascript
function getCombinedDrag(Cd, caliber, mass) {
  // caliber in meters, mass in kg
  return 0.5 * Cd * Math.PI * Math.pow(caliber / 2, 2) / mass;
}
```

### Equations of Motion
```
dvx/dt = -k × ρ(y) × vx × speed
dvy/dt = -g - k × ρ(y) × vy × speed

where:
  speed = sqrt(vx² + vy²)                # total velocity
  k = 0.5 × Cd × π × (caliber/2)² / m    # combined drag factor
  ρ(y) = air density at altitude y       # varies with height
  g = 9.81 m/s²                          # gravity
```

### Numerical Integration (RK4)
```javascript
function derivatives(state, k) {
  const { x, y, vx, vy } = state;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const rho = getAirDensity(y);
  const kRho = k * rho;

  return {
    dx: vx,
    dy: vy,
    dvx: -kRho * vx * speed,
    dvy: -PHYSICS.g - kRho * vy * speed
  };
}

function rk4Step(state, dt, k) {
  const k1 = derivatives(state, k);
  const k2 = derivatives({
    x: state.x + 0.5 * dt * k1.dx,
    y: state.y + 0.5 * dt * k1.dy,
    vx: state.vx + 0.5 * dt * k1.dvx,
    vy: state.vy + 0.5 * dt * k1.dvy
  }, k);
  const k3 = derivatives({
    x: state.x + 0.5 * dt * k2.dx,
    y: state.y + 0.5 * dt * k2.dy,
    vx: state.vx + 0.5 * dt * k2.dvx,
    vy: state.vy + 0.5 * dt * k2.dvy
  }, k);
  const k4 = derivatives({
    x: state.x + dt * k3.dx,
    y: state.y + dt * k3.dy,
    vx: state.vx + dt * k3.dvx,
    vy: state.vy + dt * k3.dvy
  }, k);

  return {
    x: state.x + dt * (k1.dx + 2*k2.dx + 2*k3.dx + k4.dx) / 6,
    y: state.y + dt * (k1.dy + 2*k2.dy + 2*k3.dy + k4.dy) / 6,
    vx: state.vx + dt * (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx) / 6,
    vy: state.vy + dt * (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy) / 6
  };
}
```

### Trajectory Simulation
```javascript
function simulateTrajectory(launchAngleDeg, shellParams) {
  const { muzzleVelocity, caliber, mass, dragCoefficient } = shellParams;
  const k = getCombinedDrag(dragCoefficient, caliber / 1000, mass); // caliber mm -> m
  const angleRad = launchAngleDeg * Math.PI / 180;

  let state = {
    x: 0,
    y: 0,
    vx: muzzleVelocity * Math.cos(angleRad),
    vy: muzzleVelocity * Math.sin(angleRad)
  };

  const dt = 0.02; // time step (seconds)
  let time = 0;

  while (state.y >= 0 && time < 60) {
    state = rk4Step(state, dt, k);
    time += dt;
  }

  return {
    range: state.x,                                              // horizontal distance (m)
    flightTime: time,                                            // raw flight time (s)
    adjustedFlightTime: time / PHYSICS.timeMultiplier,           // game-adjusted time
    impactAngle: Math.atan2(-state.vy, state.vx) * 180 / Math.PI, // degrees
    impactVelocity: Math.sqrt(state.vx * state.vx + state.vy * state.vy)
  };
}
```

### Finding Launch Angle for Target Range
```javascript
function findLaunchAngle(targetRangeMeters, shellParams) {
  let low = 0, high = 45;

  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    const result = simulateTrajectory(mid, shellParams);
    if (result.range < targetRangeMeters) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}
```

### Get Ballistics at Range
```javascript
function getBallisticsAtRange(targetRangeKm, shellParams) {
  const targetRangeM = targetRangeKm * 1000;
  const launchAngle = findLaunchAngle(targetRangeM, shellParams);
  const result = simulateTrajectory(launchAngle, shellParams);

  return {
    flightTime: result.adjustedFlightTime,  // Use game-adjusted time
    impactAngle: result.impactAngle,
    impactVelocity: result.impactVelocity
  };
}
```

## Project Structure
```
wows-ballistics-calc/
├── CLAUDE.md           # This file
├── package.json
├── src/
│   ├── index.js        # Main entry point
│   ├── physics.js      # RK4 solver and trajectory simulation
│   ├── scraper.js      # Fetch shell properties from shiptool.st
│   ├── factor.js       # BulletSpeed factor calculation
│   └── config.js       # Constants (physics, game settings)
└── configs/
    ├── HE.cfg          # HE shell weapon configs
    ├── AP.cfg          # AP shell weapon configs
    └── _summary.json   # Debug data
```

## Implementation Steps

### Phase 1: Physics Engine
1. Implement `physics.js` with functions above
2. Validate against shiptool.st values at known ranges

### Phase 2: Data Scraping
1. Scrape shell properties (muzzleVelocity, mass, dragCoefficient, caliber)
2. Store per ship per shell type in JSON

### Phase 3: Factor Calculation
1. For each ship's max range (with modifiers):
   - Calculate FT/IA using physics engine
   - Compute BulletSpeed factor: `(range × 1000) / (FT × cos(IA)) / 32`

### Phase 4: Integration
1. Generate same output format as current scraper (AP.cfg, HE.cfg)
2. Compare results with current scraper for validation

## Important Notes

### Time Multiplier
WoWS uses `timeMultiplier = 2.75` - the displayed flight time in-game is `rawTime / 2.75`. Use the **adjusted** time for factor calculations to match shiptool.st values.

### Caliber Units
- shiptool.st displays caliber in mm (e.g., 150 mm)
- Physics formulas need caliber in meters (divide by 1000)

## Validation
Compare calculated FT/IA against shiptool.st values at known ranges:
- If difference > 1%, check timeMultiplier and units
- Expected accuracy: <0.5% error

## Benefits Over Current Approach
1. **No interpolation error** - Calculate exact values at any range
2. **Faster scraping** - Only need shell properties once
3. **Extensible** - Calculate for any range including theoretical maximums
4. **Offline capable** - Once shell data cached, no network needed

## Factor Calculation

### BulletSpeed Factor
```javascript
function calculateFactor(rangeKm, flightTime, impactAngleDeg) {
  if (rangeKm <= 0 || flightTime <= 0) return null;
  const angleRad = (impactAngleDeg * Math.PI) / 180;
  const cosAngle = Math.cos(angleRad);

  // Reject angles >= 85 degrees
  if (cosAngle < 0.0872) return null;

  const rawFactor = (rangeKm * 1000 / (flightTime * cosAngle)) / 32;
  return Math.round(rawFactor * 1000) / 1000;
}
```

### Range Conversion (for config file)
```javascript
function calculateConvertedRange(rangeKm) {
  return Math.round((rangeKm * 1000) / 30.3);
}
```

## Weapon Config XML Template

### Config Structure
Each weapon has two FireMode blocks:
1. **Half-range** (MinRange: -1 to half)
2. **Max-range** (MinRange: half to max)

### Pitch Values
```javascript
const PITCH = {
  ap: {
    DD: 0,
    BB: -0.019,
    default: -0.013
  },
  other: {  // HE/SAP
    DD: 0.025,
    BB: 0.040,
    default: 0.045
  }
};

// AP shells: use 0 pitch for upper range (second FireMode)
const upperPitch = (shellType === 'AP') ? 0 : pitch;
```

### XML Template
```javascript
// rangeData = { halfRange, halfFactor, maxRange, maxFactor }
function generateWeaponConfig(shipName, shellType, rangeData, shipClass) {
  const pitch = (shellType === 'AP')
    ? (PITCH.ap[shipClass] ?? PITCH.ap.default)
    : (PITCH.other[shipClass] ?? PITCH.other.default);

  const halfConv = calculateConvertedRange(rangeData.halfRange);
  const maxConv = calculateConvertedRange(rangeData.maxRange + 0.5); // 0.5km buffer
  const upperPitch = (shellType === 'AP') ? 0 : pitch;

  return `<Weapon ${shipName}>
\t<FireMode>
\t\t<HitLocations>
\t\t\t<HitData>
\t\t\t\t<HitZone 2></HitZone>
\t\t\t\t<MinPlayerSpeed -1></MinPlayerSpeed>
\t\t\t\t<MaxPlayerSpeed -1></MaxPlayerSpeed>
\t\t\t\t<MinTargetSpeed -1></MinTargetSpeed>
\t\t\t\t<MaxTargetSpeed -1></MaxTargetSpeed>
\t\t\t\t<MinTargetHealth -1></MinTargetHealth>
\t\t\t\t<MaxTargetHealth -1></MaxTargetHealth>
\t\t\t\t<MinPlayerZoom -1></MinPlayerZoom>
\t\t\t\t<MaxPlayerZoom -1></MaxPlayerZoom>
\t\t\t\t<MinRange -1></MinRange>
\t\t\t\t<MaxRange ${halfConv}></MaxRange>
\t\t\t\t<MinAngle -1></MinAngle>
\t\t\t\t<MaxAngle -1></MaxAngle>
\t\t\t</HitData>
\t\t</HitLocations>
\t\t<Valid True></Valid>
\t\t<CanHitPlayer True></CanHitPlayer>
\t\t<CanHitVehicle True></CanHitVehicle>
\t\t<CanHitArmor True></CanHitArmor>
\t\t<CanHitPlane True></CanHitPlane>
\t\t<CanHitHeli True></CanHitHeli>
\t\t<CanHitBoat True></CanHitBoat>
\t\t<BulletSpeed ${rangeData.halfFactor.toFixed(2)}></BulletSpeed>
\t\t<BulletDrop -1></BulletDrop>
\t\t<MinZoomLevel -1></MinZoomLevel>
\t\t<AutoZoom False></AutoZoom>
\t\t<Trigger 0></Trigger>
\t\t<BulletPlayerSpeedScale 0.0></BulletPlayerSpeedScale>
\t\t<BulletTargetSpeedScale 1.0></BulletTargetSpeedScale>
\t\t<PitchToAdd ${pitch}></PitchToAdd>
\t\t<YawToAdd 0></YawToAdd>
\t</FireMode>
\t<FireMode>
\t\t<HitLocations>
\t\t\t<HitData>
\t\t\t\t<HitZone 2></HitZone>
\t\t\t\t<MinPlayerSpeed -1></MinPlayerSpeed>
\t\t\t\t<MaxPlayerSpeed -1></MaxPlayerSpeed>
\t\t\t\t<MinTargetSpeed -1></MinTargetSpeed>
\t\t\t\t<MaxTargetSpeed -1></MaxTargetSpeed>
\t\t\t\t<MinTargetHealth -1></MinTargetHealth>
\t\t\t\t<MaxTargetHealth -1></MaxTargetHealth>
\t\t\t\t<MinPlayerZoom -1></MinPlayerZoom>
\t\t\t\t<MaxPlayerZoom -1></MaxPlayerZoom>
\t\t\t\t<MinRange ${halfConv}></MinRange>
\t\t\t\t<MaxRange ${maxConv}></MaxRange>
\t\t\t\t<MinAngle -1></MinAngle>
\t\t\t\t<MaxAngle -1></MaxAngle>
\t\t\t</HitData>
\t\t</HitLocations>
\t\t<Valid True></Valid>
\t\t<CanHitPlayer True></CanHitPlayer>
\t\t<CanHitVehicle True></CanHitVehicle>
\t\t<CanHitArmor True></CanHitArmor>
\t\t<CanHitPlane True></CanHitPlane>
\t\t<CanHitHeli True></CanHitHeli>
\t\t<CanHitBoat True></CanHitBoat>
\t\t<BulletSpeed ${rangeData.maxFactor.toFixed(2)}></BulletSpeed>
\t\t<BulletDrop -1></BulletDrop>
\t\t<MinZoomLevel -1></MinZoomLevel>
\t\t<AutoZoom False></AutoZoom>
\t\t<Trigger 0></Trigger>
\t\t<BulletPlayerSpeedScale 0.0></BulletPlayerSpeedScale>
\t\t<BulletTargetSpeedScale 1.0></BulletTargetSpeedScale>
\t\t<PitchToAdd ${upperPitch}></PitchToAdd>
\t\t<YawToAdd 0></YawToAdd>
\t</FireMode>
</Weapon>`;
}
```

## Scraping URLs

```javascript
const URLS = {
  base: 'https://shiptool.st',
  params: '/params',           // Ship names, classes, max ranges
  consumables: '/params?p=con', // Spotter plane availability
  shells: {
    ap: '/params?p=ap',        // AP shell data
    he: '/params?p=he',        // HE shell data
    sap: '/params?p=sap',      // SAP shell data
  }
};
```

## Scraping Shell Properties

Shell properties are displayed on individual ship pages. Navigate to a ship's shell tab to find:
- **Description** → caliber (e.g., "150 mm")
- **Weight** → mass (e.g., "46 kg")
- **Initial speed** → muzzleVelocity (e.g., "960 m/s")
- **Drag coeff.** → dragCoefficient (e.g., "0.290")

### Scraping Strategy
Option A: Scrape from ship detail pages (more reliable, but slower - one page per ship)
Option B: Check if /params?p=ap table includes shell properties (faster if available)

## File Output Structure

### Output Files
```
configs/
├── HE.cfg          # HE shell configs (with SAP/AP fallback)
├── AP.cfg          # AP shell configs + SAP (if ship has HE)
└── _summary.json   # Debug data
```

### File Assignment Logic
```javascript
// shellResults = { he: rangeData, ap: rangeData, sap: rangeData }
// rangeData = { halfRange, halfFactor, maxRange, maxFactor }
function assignToFiles(shipName, shellResults, shipClass) {
  const hasHE = 'he' in shellResults;
  const hasAP = 'ap' in shellResults;
  const hasSAP = 'sap' in shellResults;

  const heConfigs = [];  // Goes to HE.cfg
  const apConfigs = [];  // Goes to AP.cfg

  // HE.cfg: HE if available, else SAP, else AP as fallback
  if (hasHE) {
    heConfigs.push(generateWeaponConfig(shipName, 'he', shellResults.he, shipClass));
  } else if (hasSAP) {
    heConfigs.push(generateWeaponConfig(shipName, 'sap', shellResults.sap, shipClass));
  } else if (hasAP) {
    heConfigs.push(generateWeaponConfig(shipName, 'ap', shellResults.ap, shipClass));
  }

  // AP.cfg: AP always, SAP only if ship has HE
  if (hasAP) {
    apConfigs.push(generateWeaponConfig(shipName, 'ap', shellResults.ap, shipClass));
  }
  if (hasSAP && hasHE) {
    apConfigs.push(generateWeaponConfig(shipName, 'sap', shellResults.sap, shipClass));
  }

  return { heConfigs, apConfigs };
}
```

## package.json

```json
{
  "name": "wows-ballistics-calc",
  "version": "1.0.0",
  "type": "module",
  "description": "WoWS ballistics calculator using physics simulation",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "debug": "node --inspect src/index.js"
  },
  "dependencies": {
    "puppeteer": "^21.0.0"
  }
}
```

## Main Entry Point (src/index.js)

```javascript
import fs from 'fs/promises';
import { scrapeShipData } from './scraper.js';
import { getBallisticsAtRange, calculateModifiedRange } from './physics.js';
import { calculateFactor, normalizeShipName, assignToFiles } from './utils.js';

async function main() {
  console.log('Starting WoWS Ballistics Calculator...');

  // 1. Scrape ship data (names, classes, ranges, spotter, shell properties)
  const shipData = await scrapeShipData();

  // 2. Calculate ballistics for each ship
  const results = {};
  for (const [shipName, data] of Object.entries(shipData)) {
    const modifiedRange = calculateModifiedRange(
      data.baseMaxRange, data.class, data.hasSpotter, shipName
    );

    results[shipName] = {};
    for (const [shellType, shellProps] of Object.entries(data.shells)) {
      const halfRange = modifiedRange / 2;
      const halfBallistics = getBallisticsAtRange(halfRange, shellProps);
      const maxBallistics = getBallisticsAtRange(modifiedRange, shellProps);

      results[shipName][shellType] = {
        halfRange,
        halfFactor: calculateFactor(halfRange, halfBallistics.flightTime, halfBallistics.impactAngle),
        maxRange: modifiedRange,
        maxFactor: calculateFactor(modifiedRange, maxBallistics.flightTime, maxBallistics.impactAngle),
      };
    }
  }

  // 3. Generate and write config files
  const heConfigs = [];
  const apConfigs = [];

  for (const [shipName, shellResults] of Object.entries(results)) {
    const shipClass = shipData[shipName].class;
    const { heConfigs: he, apConfigs: ap } = assignToFiles(
      normalizeShipName(shipName), shellResults, shipClass
    );
    heConfigs.push(...he);
    apConfigs.push(...ap);
  }

  await fs.writeFile('configs/HE.cfg', heConfigs.join('\n\n'));
  await fs.writeFile('configs/AP.cfg', apConfigs.join('\n\n'));
  await fs.writeFile('configs/_summary.json', JSON.stringify(results, null, 2));

  console.log('Done!');
}

main().catch(console.error);
```

## Dependencies
- `puppeteer` - For scraping shell properties
- No WASM needed - pure JavaScript physics

## Source
Physics formulas extracted from: https://github.com/jcw780/wows_shell
