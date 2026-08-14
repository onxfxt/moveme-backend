// Pricing lives on the SERVER, not the app — a client could otherwise fake a
// cheaper fare. All amounts are returned in thebe (1 BWP = 100 thebe) so we
// never do float math on money.

function bwpToThebe(bwp) { return Math.round(bwp * 100); }

// P4/km minimum, matching the prototype's rideFare()
function rideFareThebe(km) {
  let bwp;
  if (km <= 5) bwp = 20;
  else if (km <= 10) bwp = 40;
  else if (km <= 20) bwp = 80;
  else if (km <= 25) bwp = 100;
  else if (km <= 30) bwp = 120;
  else if (km <= 40) bwp = 160;
  else bwp = Math.round((km * 4) / 10) * 10;
  return bwpToThebe(bwp);
}

// Base flat-fee price list, Gaborone -> destination, for a 1-2 ton truck.
// This is your original flyer's price list.
const TOWN_PRICES_BWP = {
  "Gaborone": 300, "Gaborone North": 500, "Mogoditshane": 350, "Mmopane": 400, "Metsimotlhabe": 500,
  "Kopong": 550, "Tlokweng": 350, "Oodi": 500, "Otse": 700, "Lentsweletau": 1200, "Gabane": 450,
  "Kumakwane": 650, "Phakalane": 450, "Ramotswa": 650, "Lobatse": 850, "Thamaga": 650, "Mochudi": 650,
  "Mmakgodi": 600, "Mahalapye": 2350, "Palapye": 2950, "Serowe": 3200, "Letlhakane/Orapa": 5100,
  "Maun": 9000, "Selebi-Phikwe": 4100, "Bobonong": 4700, "Francistown": 5100, "Kasane": 9300,
  "Molepolole": 650, "Letlhakeng": 1500, "Takatokwane": 2000, "Moshupa": 750, "Kanye": 900,
  "Jwaneng": 1900, "Tsabong": 5200, "Kang": 4600, "Hukuntsi": 5100, "Gantsi": 7000, "Charles Hill": 9000
};

const CAPACITY_TIERS = ["Under 1 ton", "1-2 ton", "3-4 ton", "5-8 ton", "8-16 ton", "16-24 ton", "24-32 ton", "32 ton+"];
const ANCHOR_INDEX = 1; // "1-2 ton" is the flyer's base price

function roundBwp(x) { return x < 1000 ? Math.round(x / 50) * 50 : Math.round(x / 100) * 100; }

function truckFareThebe(destination, tierIndex) {
  const base = TOWN_PRICES_BWP[destination];
  if (base == null) return null;
  const bwp = roundBwp(base * Math.pow(1.3, tierIndex - ANCHOR_INDEX));
  return bwpToThebe(bwp);
}

function commissionRateFor(jobType, rates) {
  switch (jobType) {
    case "MOVING": return rates.moving;
    case "RIDE": return rates.ride;
    case "COURIER": return rates.courier;
    case "WASTE": return rates.waste;
    default: return rates.ride;
  }
}

module.exports = {
  bwpToThebe,
  rideFareThebe,
  truckFareThebe,
  TOWN_PRICES_BWP,
  CAPACITY_TIERS,
  commissionRateFor,
};
