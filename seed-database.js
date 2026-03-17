const {
  initDatabase,
  addGuest,
  getGuestCount,
  getDb
} = require('./database');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

initDatabase();

const SAMPLE_NAMES = [
  'James Wilson', 'Mary Johnson', 'Robert Davis', 'Patricia Miller',
  'John Smith', 'Jennifer Brown', 'Michael Williams', 'Linda Jones',
  'David Garcia', 'Elizabeth Martinez', 'Richard Anderson', 'Barbara Taylor',
  'Joseph Thomas', 'Susan Moore', 'Thomas Jackson', 'Jessica Martin',
  'Charles Lee', 'Sarah White', 'Christopher Harris', 'Karen Clark',
  'Daniel Lewis', 'Nancy Robinson', 'Matthew Walker', 'Betty Hall',
  'Anthony Young', 'Margaret Allen', 'Mark King', 'Sandra Wright',
  'Donald Scott', 'Dorothy Green', 'Steven Adams', 'Lisa Baker',
  'Paul Nelson', 'Ashley Hill', 'Andrew Campbell', 'Kimberly Mitchell',
  'Joshua Roberts', 'Emily Turner', 'Kenneth Phillips', 'Donna Carter',
  'Kevin Parker', 'Michelle Evans', 'Brian Edwards', 'Carol Edwards',
  'George Collins', 'Amanda Stewart', 'Timothy Sanchez', 'Melissa Morris',
  'Ronald Rogers', 'Deborah Reed', 'Edward Cook', 'Stephanie Morgan',
  'Jason Bell', 'Rebecca Murphy', 'Jeffrey Bailey', 'Sharon Rivera',
  'Ryan Cooper', 'Laura Richardson', 'Jacob Cox', 'Cynthia Howard',
  'Gary Ward', 'Kathleen Torres', 'Nicholas Peterson', 'Amy Gray',
  'Eric Ramirez', 'Angela James', 'Jonathan Watson', 'Christina Brooks',
  'Stephen Kelly', 'Brenda Sanders', 'Larry Price', 'Nicole Bennett',
  'Justin Wood', 'Samantha Barnes', 'Scott Ross', 'Katherine Henderson',
  'Benjamin Coleman', 'Helen Perry', 'Samuel Powell', 'Debra Long',
  'Raymond Patterson', 'Rachel Hughes', 'Gregory Flores', 'Carolyn Washington',
  'Frank Butler', 'Janet Simmons', 'Alexander Foster', 'Maria Gonzales',
  'Patrick Bryant', 'Heather Alexander', 'Jack Russell', 'Diane Griffin',
  'Dennis Diaz', 'Ruth Hayes', 'Jerry Myers', 'Pamela Ford',
  'Tyler Hamilton', 'Joy Graham', 'Aaron Sullivan', 'Evelyn Wallace',
  'Jose West', 'Judith Cole', 'Adam Jordan', 'Virginia Owens',
  'Nathan Reynolds', 'Victoria Fisher', 'Henry Ellis', 'Marilyn Harrison',
  'Douglas Gibson', 'Andrea Mcdonald', 'Peter Marshall', 'Cheryl Welch'
];

const count = getGuestCount();

if (count === 0) {
  const tables = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  SAMPLE_NAMES.forEach((name, i) => {
    const table = tables[i % tables.length];
    addGuest(name, table);
  });
  console.log(`Seeded ${SAMPLE_NAMES.length} guests across 10 tables.`);
} else {
  console.log(`Database already has ${count.c} guests. Run with empty DB to re-seed.`);
}
