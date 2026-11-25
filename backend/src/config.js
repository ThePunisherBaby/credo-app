const crypto = require('crypto');

const CLERGY_RANKS = new Set([
  'pope',
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
  'church',
  'parish',
]);

const ALL_RANKS = [
  'pope',
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
  'church',
  'parish',
  'religious',
  'seminarian',
  'catechist',
  'lay',
];

const RANK_ORDER = {
  pope: 1,
  cardinal: 2,
  archbishop: 3,
  bishop: 4,
  monsignor: 5,
  priest: 6,
  deacon: 7,
  religious: 8,
  seminarian: 9,
  catechist: 10,
  lay: 11,
};

const UNIT_TYPES = [
  'holy_see',
  'dicastery',
  'episcopal_conference',
  'archdiocese',
  'diocese',
  'vicariate',
  'parish',
  'religious_order',
  'seminary',
];

const POST_TYPES = [
  'homily',
  'pastoral_letter',
  'announcement',
  'decree',
  'reflection',
  'event',
];

function isClergyRank(rank) {
  return CLERGY_RANKS.has(rank);
}

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  if (process.env.API_KEY && process.env.API_KEY.length >= 16) {
    return crypto.createHash('sha256').update(`credo-jwt:${process.env.API_KEY}`).digest('hex');
  }
  return 'credo-local-dev-secret-change-in-production-2026';
}

module.exports = {
  PORT: Number(process.env.PORT || 8080),
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/credo',
  JWT_SECRET: getJwtSecret(),
  JWT_EXPIRES_IN: '30d',
  CLERGY_RANKS,
  ALL_RANKS,
  RANK_ORDER,
  UNIT_TYPES,
  POST_TYPES,
  isClergyRank,
};
