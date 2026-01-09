# WoWS Ballistics Calculator

A Node.js tool that calculates World of Warships shell ballistics using physics simulation and generates weapon config files.

## Quick Start

```bash
npm install
npm start
```

## Project Structure

```
wows-ballistics-calc/
├── package.json
├── src/
│   ├── index.js      # Main entry point - orchestrates scraping and calculation
│   ├── config.js     # Constants (physics, modifiers, URLs, pitch values)
│   ├── physics.js    # RK4 trajectory solver and ballistics calculations
│   ├── utils.js      # Ship name normalization, factor calculation, XML generation
│   └── scraper.js    # Puppeteer scraper for shiptool.st
└── configs/          # Output directory
    ├── HE.cfg        # HE shell weapon configs
    ├── AP.cfg        # AP shell weapon configs
    └── _summary.json # Full calculation data for debugging
```

## How It Works

### 1. Scraping (src/scraper.js)

Scrapes 5 pages from shiptool.st:
- `/params` (with "main battery" checkbox) - Ship names, classes, firing ranges
- `/params?p=con` - Consumables (spotter plane availability)
- `/params?p=ap` - AP shell properties
- `/params?p=he` - HE shell properties
- `/params?p=sap` - SAP shell properties

**Key selectors:**
- `span.link` containing "all" - Click to expand ship groups
- `label.checkbox` - Enable filters like "main battery"
- `table`, `th`, `tbody tr`, `td` - Extract table data

**Shell properties extracted from tables:**
- `initial speed` → muzzleVelocity (m/s)
- `weight` → mass (kg)
- `drag coeff.` → dragCoefficient
- `description` → caliber (mm)

### 2. Physics Engine (src/physics.js)

Uses RK4 (Runge-Kutta 4th order) numerical integration to simulate shell trajectories.

**Constants:**
```javascript
g = 9.81           // gravity (m/s²)
t0 = 288.15        // sea level temperature (K)
L = 0.0065         // temperature lapse rate (K/m)
p0 = 101325        // sea level pressure (Pa)
timeMultiplier = 2.75  // WoWS game time scaling
```

**Key functions:**
- `getAirDensity(y)` - Atmospheric model (density varies with altitude)
- `simulateTrajectory(angle, shellParams)` - Full trajectory simulation
- `findLaunchAngle(targetRange, shellParams)` - Binary search for launch angle
- `getBallisticsAtRange(rangeKm, shellParams)` - Main API: returns FT, IA, velocity
- `calculateModifiedRange(base, class, spotter, name)` - Applies range modifiers

### 3. Range Modifiers (src/config.js)

```javascript
MODIFIERS = {
  aftMultiplier: 1.2,      // All DDs get +20% (AFT skill)
  spotterMultiplier: 1.2,  // BB/CA/CB/CL with spotter get +20%
  rangeBuffer: 1.05,       // Universal +5% buffer
  uniqueUpgrades: {
    'Henri IV': 1.05       // Ship-specific modifiers
  }
}
```

### 4. Factor Calculation (src/utils.js)

```javascript
factor = (range_m / (flightTime * cos(impactAngle))) / 32
```

Angles ≥ 85° are rejected (cos < 0.0872).

### 5. Config Generation (src/utils.js)

Each weapon has two FireMode blocks:
1. **Half-range**: MinRange -1 to halfRange
2. **Max-range**: MinRange halfRange to maxRange + 0.5km buffer

**Pitch values by shell type and class:**
- AP: DD=0, BB=-0.019, default=-0.013
- HE/SAP: DD=0.025, BB=0.040, default=0.045
- AP upper range always uses pitch=0

**File assignment:**
- `HE.cfg`: HE → SAP fallback → AP fallback
- `AP.cfg`: AP always + SAP (only if ship has HE)

### 6. Ship Name Normalization

Transforms ship names for config output:
- Suffix transforms: " B" → "Black_", " Golden" → "Gold_"
- Exact replacements: Yueyang → Hsiang_Yang, Zao → Zao_1944
- Diacritics removed, special chars replaced with underscores

## Output

**HE.cfg / AP.cfg format:**
```xml
<Weapon ShipName>
  <FireMode>
    <MinRange -1></MinRange>
    <MaxRange {halfConv}></MaxRange>
    <BulletSpeed {halfFactor}></BulletSpeed>
    <PitchToAdd {pitch}></PitchToAdd>
    ...
  </FireMode>
  <FireMode>
    <MinRange {halfConv}></MinRange>
    <MaxRange {maxConv}></MaxRange>
    <BulletSpeed {maxFactor}></BulletSpeed>
    ...
  </FireMode>
</Weapon>
```

**_summary.json structure:**
```json
{
  "ShipName": {
    "class": "BB",
    "baseMaxRange": 26.6,
    "modifiedRange": 27.93,
    "hasSpotter": false,
    "shells": {
      "ap": {
        "halfRange": 13.97,
        "halfFactor": 61.44,
        "halfFlightTime": 7.19,
        "halfImpactAngle": 8.7,
        "maxRange": 27.93,
        "maxFactor": 56.26,
        "maxFlightTime": 17.15,
        "maxImpactAngle": 25.2,
        "shellProps": { "muzzleVelocity": 840, "mass": 1321, "dragCoefficient": 0.35, "caliber": 431 }
      }
    }
  }
}
```

## Skipped Classes

- `SS` (Submarines)
- `CV` (Carriers)

## Dependencies

- `puppeteer` ^23.0.0 - Headless browser for scraping

## Comparison with Old Scraper

| Aspect | Old (shiptool-scraper) | New (physics-based) |
|--------|------------------------|---------------------|
| Data source | FT/IA from website at 31 range points | Shell properties only |
| Interpolation | Quadratic Lagrange (3 points) | None - exact calculation |
| Accuracy | Interpolation error possible | Exact at any range |
| Speed | Slower (31 range adjustments per shell type) | Faster (one-time property scrape) |
| Offline | Needs full re-scrape | Can recalculate with cached props |

## Validation

Compare calculated flight times against shiptool.st values:
- Expected accuracy: < 0.5% error
- If difference > 1%, check timeMultiplier (2.75) and caliber units (mm → m)
