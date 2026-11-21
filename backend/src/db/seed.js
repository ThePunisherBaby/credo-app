const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM ecclesiastical_units');
  if (rows[0].cnt > 0) {
    return;
  }

  console.log('[seed] Initializing worldwide ecclesiastical hierarchy and sample data...');

  const unitIds = {};

  async function addUnit(u) {
    const parentId = u.parent ? unitIds[u.parent] : null;
    const res = await pool.query(
      `INSERT INTO ecclesiastical_units (
         slug, name, official_latin_name, unit_type, parent_id,
         country_code, country_name, city, rite, patron_saint,
         motto, website, founded_year, description, accent_color, verified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE)
       RETURNING id`,
      [
        u.slug,
        u.name,
        u.latin || '',
        u.type,
        parentId,
        u.cc || 'VA',
        u.country || 'Ciudad del Vaticano',
        u.city || '',
        u.rite || 'Latin',
        u.patron || '',
        u.motto || '',
        u.website || '',
        u.founded || null,
        u.desc || '',
        u.color || '#8B1E3F',
      ]
    );
    unitIds[u.slug] = res.rows[0].id;
    return res.rows[0].id;
  }

  // 1. SANTA SEDE (Raíz Universal)
  await addUnit({
    slug: 'santa-sede',
    name: 'Santa Sede — Iglesia Católica Universal',
    latin: 'Sancta Sedes · Ecclesia Catholica',
    type: 'holy_see',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    patron: 'San Pedro y San Pablo',
    motto: 'Ut unum sint',
    website: 'https://www.vatican.va',
    founded: 33,
    desc: 'Sede Apostólica de Roma y centro de comunión visible de la Iglesia Católica en todo el mundo.',
    color: '#B8860B',
  });

  // Dicasterios Vaticanos
  await addUnit({
    slug: 'secretaria-de-estado',
    name: 'Secretaría de Estado',
    latin: 'Secretaria Status',
    type: 'dicastery',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    desc: 'Dicasterio de la Curia Romana que asiste directamente al Romano Pontífice en el gobierno de la Iglesia universal y relaciones diplomáticas.',
    color: '#9B1C2E',
  });
  await addUnit({
    slug: 'dicasterio-doctrina-fe',
    name: 'Dicasterio para la Doctrina de la Fe',
    latin: 'Dicasterium pro Doctrina Fidei',
    type: 'dicastery',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    founded: 1542,
    desc: 'Promueve y tutela la doctrina sobre la fe y las costumbres en todo el orbe católico.',
    color: '#9B1C2E',
  });
  await addUnit({
    slug: 'dicasterio-obispos',
    name: 'Dicasterio para los Obispos',
    latin: 'Dicasterium pro Episcopis',
    type: 'dicastery',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    desc: 'Atiende todo lo concerniente a la constitución de Iglesias particulares y al nombramiento de obispos.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'dicasterio-evangelizacion',
    name: 'Dicasterio para la Evangelización',
    latin: 'Dicasterium pro Evangelizatione',
    type: 'dicastery',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    desc: 'Coordina la obra misionera y la nueva evangelización en los cinco continentes.',
    color: '#8B5A2B',
  });

  // Diócesis de Roma
  await addUnit({
    slug: 'diocesis-roma',
    name: 'Diócesis de Roma',
    latin: 'Dioecesis Urbis seu Romana',
    type: 'archdiocese',
    parent: 'santa-sede',
    cc: 'IT',
    country: 'Italia',
    city: 'Roma',
    patron: 'San Pedro y San Pablo',
    founded: 42,
    desc: 'Sede del Obispo de Roma, Primado de Italia y Pastor de la Iglesia Universal.',
    color: '#B8860B',
  });
  await addUnit({
    slug: 'basilica-san-pedro',
    name: 'Basílica Papal de San Pedro',
    latin: 'Basilica Sancti Petri in Vaticano',
    type: 'parish',
    parent: 'diocesis-roma',
    cc: 'VA',
    country: 'Ciudad del Vaticano',
    city: 'Ciudad del Vaticano',
    patron: 'San Pedro Apóstol',
    founded: 324,
    desc: 'Basílica Mayor edificada sobre la tumba del Apóstol Pedro.',
    color: '#B8860B',
  });

  // 2. REPÚBLICA DOMINICANA (CED)
  await addUnit({
    slug: 'ced-republica-dominicana',
    name: 'Conferencia del Episcopado Dominicano (CED)',
    latin: 'Conferentia Episcopalis Dominicana',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santo Domingo',
    patron: 'Nuestra Señora de la Altagracia',
    founded: 1962,
    desc: 'Asamblea permanente de los obispos de la República Dominicana para el ejercicio conjunto de funciones pastorales.',
    color: '#1E3A5F',
  });
  await addUnit({
    slug: 'arquidiocesis-santo-domingo',
    name: 'Arquidiócesis de Santo Domingo',
    latin: 'Archidioecesis Sancti Dominici',
    type: 'archdiocese',
    parent: 'ced-republica-dominicana',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santo Domingo',
    patron: 'Nuestra Señora de la Encarnación',
    founded: 1511,
    desc: 'Sede Metropolitana y Primada de América, erigida por el Papa Julio II en 1511.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'catedral-primada-america',
    name: 'Catedral Primada de América — Basílica Menor de Santa María',
    latin: 'Cathedralis Basilica Minor Sanctae Mariae Incarnationis',
    type: 'parish',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santo Domingo',
    patron: 'Santa María la Menor',
    founded: 1514,
    desc: 'Primera catedral construida en el Nuevo Mundo, corazón histórico y espiritual de la Zona Colonial.',
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'parroquia-san-judas-tadeo-sd',
    name: 'Parroquia San Judas Tadeo',
    type: 'parish',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santo Domingo',
    patron: 'San Judas Tadeo',
    desc: 'Comunidad parroquial del Ensanche Naco dedicada a la formación litúrgica y pastoral familiar.',
    color: '#355070',
  });
  await addUnit({
    slug: 'seminario-santo-tomas-aquino',
    name: 'Seminario Pontificio Santo Tomás de Aquino',
    latin: 'Seminarium Pontificium Sancti Thomae Aquinatis',
    type: 'seminary',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santo Domingo',
    patron: 'Santo Tomás de Aquino',
    founded: 1848,
    desc: 'Casa nacional de formación sacerdotal y Facultad de Filosofía y Teología.',
    color: '#4A5568',
  });
  await addUnit({
    slug: 'diocesis-higuey',
    name: 'Diócesis de Nuestra Señora de la Altagracia en Higüey',
    latin: 'Dioecesis a Domina Nostra de Altagratia in Higuey',
    type: 'diocese',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Higüey',
    patron: 'Nuestra Señora de la Altagracia',
    founded: 1959,
    desc: 'Diócesis sufragánea de Santo Domingo que custodia el Santuario Nacional de la Madre Espiritual del pueblo dominicano.',
    color: '#1D4E89',
  });
  await addUnit({
    slug: 'basilica-altagracia-higuey',
    name: 'Basílica Catedral Nuestra Señora de la Altagracia',
    type: 'parish',
    parent: 'diocesis-higuey',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Higüey',
    patron: 'Nuestra Señora de la Altagracia',
    founded: 1971,
    desc: 'Santuario Mariano Nacional y catedral diocesana, centro de peregrinación del Caribe.',
    color: '#1D4E89',
  });
  await addUnit({
    slug: 'diocesis-bani',
    name: 'Diócesis de Baní',
    latin: 'Dioecesis Baniensis',
    type: 'diocese',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Baní',
    patron: 'Nuestra Señora de Regla',
    founded: 1986,
    desc: 'Iglesia particular sufragánea de la Provincia Eclesiástica de Santo Domingo.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'diocesis-san-pedro-macoris',
    name: 'Diócesis de San Pedro de Macorís',
    latin: 'Dioecesis Sancti Petri de Macoris',
    type: 'diocese',
    parent: 'arquidiocesis-santo-domingo',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'San Pedro de Macorís',
    patron: 'San Pedro Apóstol',
    founded: 1997,
    desc: 'Diócesis del este dominicano sufragánea de Santo Domingo.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'arquidiocesis-santiago-rd',
    name: 'Arquidiócesis de Santiago de los Caballeros',
    latin: 'Archidioecesis Sancti Iacobi Equitum',
    type: 'archdiocese',
    parent: 'ced-republica-dominicana',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santiago de los Caballeros',
    patron: 'Santiago Apóstol el Mayor',
    founded: 1953,
    desc: 'Sede Metropolitana del Cibao, elevada a Arquidiócesis en 1994.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'catedral-santiago-apostol-rd',
    name: 'Catedral Santiago Apóstol el Mayor',
    type: 'parish',
    parent: 'arquidiocesis-santiago-rd',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Santiago de los Caballeros',
    patron: 'Santiago Apóstol',
    desc: 'Templo madre de la Arquidiócesis de Santiago de los Caballeros.',
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'diocesis-la-vega',
    name: 'Diócesis de La Vega',
    latin: 'Dioecesis Vegensis',
    type: 'diocese',
    parent: 'arquidiocesis-santiago-rd',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'La Vega',
    patron: 'Nuestra Señora de las Mercedes',
    founded: 1953,
    desc: 'Custodia del Santo Cerro y cuna histórica de la evangelización en el Cibao.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'diocesis-puerto-plata',
    name: 'Diócesis de Puerto Plata',
    latin: 'Dioecesis Portus Argentarii',
    type: 'diocese',
    parent: 'arquidiocesis-santiago-rd',
    cc: 'DO',
    country: 'República Dominicana',
    city: 'Puerto Plata',
    patron: 'San Felipe Apóstol',
    founded: 1996,
    desc: 'Diócesis de la costa norte sufragánea de Santiago de los Caballeros.',
    color: '#6B2D5C',
  });

  // 3. ESPAÑA (CEE)
  await addUnit({
    slug: 'cee-espana',
    name: 'Conferencia Episcopal Española (CEE)',
    latin: 'Conferentia Episcopalis Hispaniae',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'ES',
    country: 'España',
    city: 'Madrid',
    founded: 1966,
    desc: 'Institución de los obispos españoles en comunión con el Romano Pontífice.',
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'arquidiocesis-madrid',
    name: 'Archidiócesis de Madrid',
    latin: 'Archidioecesis Matritensis',
    type: 'archdiocese',
    parent: 'cee-espana',
    cc: 'ES',
    country: 'España',
    city: 'Madrid',
    patron: 'Santa María la Real de la Almudena',
    founded: 1885,
    desc: 'Sede Metropolitana de la Provincia Eclesiástica de Madrid.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'catedral-almudena',
    name: 'Catedral de Santa María la Real de la Almudena',
    type: 'parish',
    parent: 'arquidiocesis-madrid',
    cc: 'ES',
    country: 'España',
    city: 'Madrid',
    patron: 'Virgen de la Almudena',
    founded: 1993,
    desc: 'Sede episcopal de Madrid consagrada por San Juan Pablo II en 1993.',
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'diocesis-getafe',
    name: 'Diócesis de Getafe',
    latin: 'Dioecesis Xetafensis',
    type: 'diocese',
    parent: 'arquidiocesis-madrid',
    cc: 'ES',
    country: 'España',
    city: 'Getafe',
    patron: 'Sagrado Corazón de Jesús',
    founded: 1991,
    desc: 'Diócesis sufragánea de Madrid que alberga el Cerro de los Ángeles.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'arquidiocesis-toledo',
    name: 'Archidiócesis de Toledo',
    latin: 'Archidioecesis Toletana',
    type: 'archdiocese',
    parent: 'cee-espana',
    cc: 'ES',
    country: 'España',
    city: 'Toledo',
    patron: 'Santa María de Toledo',
    founded: 300,
    desc: 'Sede Primada de España, cuna del rito hispano-mozárabe.',
    color: '#9B1C2E',
  });
  await addUnit({
    slug: 'arquidiocesis-barcelona',
    name: 'Archidiócesis de Barcelona',
    latin: 'Archidioecesis Barcinonensis',
    type: 'archdiocese',
    parent: 'cee-espana',
    cc: 'ES',
    country: 'España',
    city: 'Barcelona',
    patron: 'Santa Eulalia y Virgen de la Merced',
    founded: 343,
    desc: 'Sede Metropolitana de Cataluña.',
    color: '#6B2D5C',
  });

  // 4. MÉXICO (CEM)
  await addUnit({
    slug: 'cem-mexico',
    name: 'Conferencia del Episcopado Mexicano (CEM)',
    latin: 'Conferentia Episcopalis Mexicana',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'MX',
    country: 'México',
    city: 'Ciudad de México',
    patron: 'Nuestra Señora de Guadalupe',
    founded: 1955,
    desc: 'Órgano colegial de los obispos de México.',
    color: '#1F5C3E',
  });
  await addUnit({
    slug: 'arquidiocesis-mexico',
    name: 'Arquidiócesis Primada de México',
    latin: 'Archidioecesis Mexicana',
    type: 'archdiocese',
    parent: 'cem-mexico',
    cc: 'MX',
    country: 'México',
    city: 'Ciudad de México',
    patron: 'Santa María de Guadalupe',
    founded: 1530,
    desc: 'Primera sede episcopal de tierra firme en América del Norte.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'basilica-guadalupe-mx',
    name: 'Insigne y Nacional Basílica de Santa María de Guadalupe',
    type: 'parish',
    parent: 'arquidiocesis-mexico',
    cc: 'MX',
    country: 'México',
    city: 'Ciudad de México',
    patron: 'Nuestra Señora de Guadalupe',
    founded: 1531,
    desc: 'Santuario Mariano del Tepeyac, el más visitado del continente americano.',
    color: '#1F5C3E',
  });
  await addUnit({
    slug: 'arquidiocesis-guadalajara',
    name: 'Arquidiócesis de Guadalajara',
    latin: 'Archidioecesis Guadalaiarensis',
    type: 'archdiocese',
    parent: 'cem-mexico',
    cc: 'MX',
    country: 'México',
    city: 'Guadalajara',
    patron: 'Nuestra Señora de Zapopan',
    founded: 1548,
    desc: 'Sede Metropolitana de Jalisco y occidente de México.',
    color: '#6B2D5C',
  });

  // 5. ESTADOS UNIDOS (USCCB)
  await addUnit({
    slug: 'usccb-usa',
    name: 'United States Conference of Catholic Bishops (USCCB)',
    latin: 'Conferentia Episcoporum Civitatum Foederatarum Americae',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'US',
    country: 'United States',
    city: 'Washington, D.C.',
    patron: 'Immaculate Conception',
    founded: 1966,
    desc: 'Assembly of the hierarchy of the Catholic Church in the United States and the U.S. Virgin Islands.',
    color: '#1E3A5F',
  });
  await addUnit({
    slug: 'archdiocese-new-york',
    name: 'Archdiocese of New York',
    latin: 'Archidioecesis Neo-Eboracensis',
    type: 'archdiocese',
    parent: 'usccb-usa',
    cc: 'US',
    country: 'United States',
    city: 'New York',
    patron: 'Saint Patrick',
    founded: 1808,
    desc: 'Metropolitan See serving Manhattan, the Bronx, Staten Island, and seven Hudson Valley counties.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'st-patricks-cathedral-ny',
    name: "St. Patrick's Cathedral",
    type: 'parish',
    parent: 'archdiocese-new-york',
    cc: 'US',
    country: 'United States',
    city: 'New York',
    patron: 'Saint Patrick',
    founded: 1879,
    desc: 'Neo-Gothic cathedral and seat of the Archbishop of New York on Fifth Avenue.',
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'diocese-brooklyn',
    name: 'Diocese of Brooklyn',
    latin: 'Dioecesis Bruklyniensis',
    type: 'diocese',
    parent: 'archdiocese-new-york',
    cc: 'US',
    country: 'United States',
    city: 'Brooklyn, NY',
    patron: 'Saint James',
    founded: 1853,
    desc: 'The Diocese of Immigrants, serving Brooklyn and Queens.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'archdiocese-los-angeles',
    name: 'Archdiocese of Los Angeles',
    latin: 'Archidioecesis Angelorum in California',
    type: 'archdiocese',
    parent: 'usccb-usa',
    cc: 'US',
    country: 'United States',
    city: 'Los Angeles',
    patron: 'Our Lady of the Angels',
    founded: 1840,
    desc: 'Largest Catholic archdiocese in the United States by population.',
    color: '#6B2D5C',
  });

  // 6. ITALIA (CEI)
  await addUnit({
    slug: 'cei-italia',
    name: 'Conferenza Episcopale Italiana (CEI)',
    latin: 'Conferentia Episcopalis Italiae',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'IT',
    country: 'Italia',
    city: 'Roma',
    patron: 'San Francesco d’Assisi e Santa Caterina da Siena',
    founded: 1952,
    desc: 'Assemblea permanente dei Vescovi italiani in comunione con il Vescovo di Roma.',
    color: '#2B593F',
  });
  await addUnit({
    slug: 'arcidiocesi-milano',
    name: 'Arcidiocesi di Milano',
    latin: 'Archidioecesis Mediolanensis',
    type: 'archdiocese',
    parent: 'cei-italia',
    cc: 'IT',
    country: 'Italia',
    city: 'Milano',
    rite: 'Ambrosian',
    patron: 'Sant’Ambrogio',
    founded: 200,
    desc: 'Sede Metropolitana di rito ambrosiano, tra le più grandi diocesi del mondo.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'duomo-milano',
    name: 'Cattedrale Metropolitana di Santa Maria Nascente (Duomo)',
    type: 'parish',
    parent: 'arcidiocesi-milano',
    cc: 'IT',
    country: 'Italia',
    city: 'Milano',
    rite: 'Ambrosian',
    patron: 'Santa Maria Nascente',
    founded: 1386,
    desc: 'Chiesa madre dell’Arcidiocesi di Milano.',
    color: '#8B1E3F',
  });

  // 7. ARGENTINA, BRASIL, COLOMBIA, FRANCIA, POLONIA, FILIPINAS
  await addUnit({
    slug: 'cea-argentina',
    name: 'Conferencia Episcopal Argentina (CEA)',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'AR',
    country: 'Argentina',
    city: 'Buenos Aires',
    patron: 'Nuestra Señora de Luján',
    color: '#2C6E91',
  });
  await addUnit({
    slug: 'arquidiocesis-buenos-aires',
    name: 'Arquidiócesis de Buenos Aires',
    latin: 'Archidioecesis Bonaërensis',
    type: 'archdiocese',
    parent: 'cea-argentina',
    cc: 'AR',
    country: 'Argentina',
    city: 'Buenos Aires',
    patron: 'San Martín de Tours',
    founded: 1620,
    desc: 'Sede Metropolitana de Buenos Aires.',
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'cnbb-brasil',
    name: 'Conferência Nacional dos Bispos do Brasil (CNBB)',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'BR',
    country: 'Brasil',
    city: 'Brasília',
    patron: 'Nossa Senhora Aparecida',
    founded: 1952,
    color: '#1F6F43',
  });
  await addUnit({
    slug: 'arquidiocese-sao-paulo',
    name: 'Arquidiocese de São Paulo',
    latin: 'Archidioecesis Sancti Pauli in Brasilia',
    type: 'archdiocese',
    parent: 'cnbb-brasil',
    cc: 'BR',
    country: 'Brasil',
    city: 'São Paulo',
    patron: 'São Paulo Apóstolo',
    founded: 1745,
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'cec-colombia',
    name: 'Conferencia Episcopal de Colombia (CEC)',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'CO',
    country: 'Colombia',
    city: 'Bogotá',
    patron: 'Nuestra Señora del Rosario de Chiquinquirá',
    color: '#8F6A16',
  });
  await addUnit({
    slug: 'arquidiocesis-bogota',
    name: 'Arquidiócesis de Bogotá',
    latin: 'Archidioecesis Bogotensis',
    type: 'archdiocese',
    parent: 'cec-colombia',
    cc: 'CO',
    country: 'Colombia',
    city: 'Bogotá',
    patron: 'Inmaculada Concepción',
    founded: 1562,
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'cef-francia',
    name: 'Conférence des évêques de France (CEF)',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'FR',
    country: 'France',
    city: 'Paris',
    patron: 'Notre-Dame de l’Assomption',
    color: '#203A63',
  });
  await addUnit({
    slug: 'archidiocese-paris',
    name: 'Archidiocèse de Paris',
    latin: 'Archidioecesis Parisiensis',
    type: 'archdiocese',
    parent: 'cef-francia',
    cc: 'FR',
    country: 'France',
    city: 'Paris',
    patron: 'Saint Denis et Sainte Geneviève',
    founded: 250,
    color: '#6B2D5C',
  });
  await addUnit({
    slug: 'notre-dame-paris',
    name: 'Cathédrale Notre-Dame de Paris',
    type: 'parish',
    parent: 'archidiocese-paris',
    cc: 'FR',
    country: 'France',
    city: 'Paris',
    patron: 'Notre-Dame',
    founded: 1163,
    color: '#8B1E3F',
  });
  await addUnit({
    slug: 'cbcp-philippines',
    name: 'Catholic Bishops’ Conference of the Philippines (CBCP)',
    type: 'episcopal_conference',
    parent: 'santa-sede',
    cc: 'PH',
    country: 'Philippines',
    city: 'Manila',
    color: '#1E4D7B',
  });
  await addUnit({
    slug: 'archdiocese-manila',
    name: 'Archdiocese of Manila',
    latin: 'Archidioecesis Manilensis',
    type: 'archdiocese',
    parent: 'cbcp-philippines',
    cc: 'PH',
    country: 'Philippines',
    city: 'Manila',
    founded: 1579,
    color: '#6B2D5C',
  });

  // 8. ÓRDENES Y CONGREGACIONES RELIGIOSAS (Derecho Pontificio)
  await addUnit({
    slug: 'compania-de-jesus-sj',
    name: 'Compañía de Jesús — Jesuitas (SJ)',
    latin: 'Societas Iesu',
    type: 'religious_order',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Internacional',
    city: 'Roma',
    patron: 'San Ignacio de Loyola',
    motto: 'Ad maiorem Dei gloriam',
    founded: 1540,
    desc: 'Orden religiosa de clérigos regulares fundada por San Ignacio de Loyola dedicada a la evangelización, educación y discernimiento.',
    color: '#3B2F2F',
  });
  await addUnit({
    slug: 'orden-predicadores-op',
    name: 'Orden de Predicadores — Dominicos (OP)',
    latin: 'Ordo Praedicatorum',
    type: 'religious_order',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Internacional',
    city: 'Roma',
    patron: 'Santo Domingo de Guzmán',
    motto: 'Veritas · Contemplata aliis tradere',
    founded: 1216,
    desc: 'Orden mendicante consagrada a la predicación del Evangelio y al estudio teológico.',
    color: '#2D3748',
  });
  await addUnit({
    slug: 'orden-frailes-menores-ofm',
    name: 'Orden de Frailes Menores — Franciscanos (OFM)',
    latin: 'Ordo Fratrum Minorum',
    type: 'religious_order',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Internacional',
    city: 'Roma',
    patron: 'San Francisco de Asís',
    motto: 'Pax et Bonum',
    founded: 1209,
    desc: 'Fraternidad evangélica inspirada en San Francisco de Asís al servicio de los pobres y la creación.',
    color: '#6E472B',
  });
  await addUnit({
    slug: 'salesianos-sdb',
    name: 'Salesianos de Don Bosco (SDB)',
    latin: 'Societas Sancti Francisci Salesii',
    type: 'religious_order',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Internacional',
    city: 'Roma',
    patron: 'San Juan Bosco',
    motto: 'Da mihi animas, cetera tolle',
    founded: 1859,
    desc: 'Congregación dedicada a la educación y evangelización de la juventud.',
    color: '#1E4E79',
  });
  await addUnit({
    slug: 'benedictinos-osb',
    name: 'Confederación Benedictina (OSB)',
    latin: 'Ordo Sancti Benedicti',
    type: 'religious_order',
    parent: 'santa-sede',
    cc: 'VA',
    country: 'Internacional',
    city: 'Roma',
    patron: 'San Benito de Nursia',
    motto: 'Ora et Labora',
    founded: 529,
    desc: 'Tradición monástica milenaria centrada en la liturgia de las horas, la lectio divina y la hospitalidad.',
    color: '#222222',
  });

  // 9. USUARIOS DE MUESTRA (Jerarquía completa + cuentas demo para probar Clero vs Laico)
  const demoPassHash = await bcrypt.hash('Credo2026!', 10);
  const userIds = {};

  async function addUser(u) {
    const res = await pool.query(
      `INSERT INTO users (
         email, password_hash, username, full_name, title_prefix,
         ecclesiastical_rank, religious_order_initials, primary_unit_id,
         religious_order_id, current_office_title, bio, motto,
         ordination_date, country_code, languages, preferred_locale,
         avatar_color, verification_status, is_admin
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        u.email,
        demoPassHash,
        u.username,
        u.fullName,
        u.prefix || '',
        u.rank,
        u.orderInit || '',
        u.unit ? unitIds[u.unit] : null,
        u.order ? unitIds[u.order] : null,
        u.office || '',
        u.bio || '',
        u.motto || '',
        u.ordDate || null,
        u.cc || 'VA',
        u.langs || ['es'],
        u.locale || 'es',
        u.color || '#7A1C2E',
        u.verified || 'verified',
        Boolean(u.admin),
      ]
    );
    userIds[u.username] = res.rows[0].id;
    return res.rows[0].id;
  }

  await addUser({
    email: 'cardenal.valerio@credo.org',
    username: 'card_valerio',
    fullName: 'Lorenzo Valerio',
    prefix: 'S.E.R. Card.',
    rank: 'cardinal',
    unit: 'dicasterio-evangelizacion',
    office: 'Cardenal Pro-Prefecto',
    bio: 'Al servicio de la evangelización universal y del diálogo entre las Iglesias particulares en los cinco continentes.',
    motto: 'In Verbo Tuo laxabo rete',
    ordDate: '1989-06-29',
    cc: 'VA',
    langs: ['it', 'es', 'en', 'fr'],
    locale: 'it',
    color: '#9B1C2E',
    admin: true,
  });

  await addUser({
    email: 'arzobispo.santo.domingo@credo.org',
    username: 'mons_rafael_sd',
    fullName: 'Rafael Antonio Morales',
    prefix: 'S.E.R. Mons.',
    rank: 'archbishop',
    unit: 'arquidiocesis-santo-domingo',
    office: 'Arzobispo Metropolitano',
    bio: 'Pastor de la Sede Primada de América. Comprometido con la comunión sinodal, la familia y las vocaciones.',
    motto: 'Duc in altum',
    ordDate: '1994-07-16',
    cc: 'DO',
    langs: ['es', 'it', 'en'],
    locale: 'es',
    color: '#6B2D5C',
    admin: true,
  });

  await addUser({
    email: 'obispo.higuey@credo.org',
    username: 'mons_gabriel_higuey',
    fullName: 'Gabriel Enrique Santana',
    prefix: 'S.E.R. Mons.',
    rank: 'bishop',
    unit: 'diocesis-higuey',
    office: 'Obispo Diocesano',
    bio: 'Obispo de Nuestra Señora de la Altagracia en Higüey, custodio pastoral del Santuario Nacional.',
    motto: 'Sub tuum praesidium',
    ordDate: '1998-01-21',
    cc: 'DO',
    langs: ['es'],
    locale: 'es',
    color: '#5B2C6F',
  });

  await addUser({
    email: 'padre.mateo@credo.org',
    username: 'p_mateo_catedral',
    fullName: 'Mateo de la Cruz',
    prefix: 'P.',
    rank: 'priest',
    unit: 'catedral-primada-america',
    office: 'Párroco Rector',
    bio: 'Sacerdote diocesano de Santo Domingo. Párroco de la Catedral Primada de América y docente de Teología Sacramental.',
    motto: 'Servire Deo regnare est',
    ordDate: '2011-08-15',
    cc: 'DO',
    langs: ['es', 'en', 'it'],
    locale: 'es',
    color: '#2C3038',
  });

  await addUser({
    email: 'arzobispo.madrid@credo.org',
    username: 'mons_alvaro_madrid',
    fullName: 'Álvaro Mendoza Ruiz',
    prefix: 'S.E.R. Mons.',
    rank: 'archbishop',
    unit: 'arquidiocesis-madrid',
    office: 'Arzobispo de Madrid',
    bio: 'Acompañando la vida pastoral, universitaria y caritativa de la Archidiócesis de Madrid.',
    motto: 'Caritas Christi urget nos',
    ordDate: '1991-05-19',
    cc: 'ES',
    langs: ['es', 'fr', 'it'],
    locale: 'es',
    color: '#6B2D5C',
  });

  await addUser({
    email: 'archbishop.ny@credo.org',
    username: 'abp_thomas_ny',
    fullName: 'Thomas Edward Callahan',
    prefix: 'Most Rev.',
    rank: 'archbishop',
    unit: 'archdiocese-new-york',
    office: 'Metropolitan Archbishop',
    bio: 'Serving the faithful of the Archdiocese of New York in communion with the See of Peter.',
    motto: 'Ad Jesum per Mariam',
    ordDate: '1992-05-30',
    cc: 'US',
    langs: ['en', 'es'],
    locale: 'en',
    color: '#6B2D5C',
  });

  await addUser({
    email: 'padre.ignacio.sj@credo.org',
    username: 'p_ignacio_sj',
    fullName: 'Ignacio Castellanos',
    prefix: 'P.',
    rank: 'priest',
    orderInit: 'SJ',
    unit: 'basilica-guadalupe-mx',
    order: 'compania-de-jesus-sj',
    office: 'Capellán y Director de Ejercicios Espirituales',
    bio: 'Sacerdote jesuita dedicado al acompañamiento espiritual, juventud universitaria y pastoral del Tepeyac.',
    motto: 'En todo amar y servir',
    ordDate: '2014-07-31',
    cc: 'MX',
    langs: ['es', 'en', 'pt'],
    locale: 'es',
    color: '#3B2F2F',
  });

  await addUser({
    email: 'don.marco.milano@credo.org',
    username: 'don_marco_mi',
    fullName: 'Marco Bellini',
    prefix: 'Don',
    rank: 'priest',
    unit: 'duomo-milano',
    office: 'Canonico del Capitolo Metropolitano',
    bio: 'Presbitero dell’Arcidiocesi di Milano. Liturgia ambrosiana, musica sacra e catechesi degli adulti.',
    motto: 'Veni Creator Spiritus',
    ordDate: '2009-06-13',
    cc: 'IT',
    langs: ['it', 'fr', 'en'],
    locale: 'it',
    color: '#2F3E46',
  });

  await addUser({
    email: 'diacono.lucas@credo.org',
    username: 'diac_lucas_ba',
    fullName: 'Lucas Fernández',
    prefix: 'Diác.',
    rank: 'deacon',
    unit: 'arquidiocesis-buenos-aires',
    office: 'Diácono Permanente — Pastoral Social',
    bio: 'Diácono permanente en Buenos Aires, casado y padre de tres hijos, sirviendo en Cáritas y pastoral hospitalaria.',
    motto: 'No vine a ser servido, sino a servir',
    ordDate: '2018-11-24',
    cc: 'AR',
    langs: ['es', 'pt'],
    locale: 'es',
    color: '#355070',
  });

  await addUser({
    email: 'maria.laica@credo.org',
    username: 'maria_esperanza',
    fullName: 'María Esperanza Peña',
    prefix: '',
    rank: 'lay',
    unit: 'catedral-primada-america',
    office: 'Fiel Parroquiana · Coro Litúrgico',
    bio: 'Laica comprometida de la Catedral Primada de América. Sigo con alegría las enseñanzas de nuestros pastores en todo el mundo.',
    motto: 'Fiat voluntas tua',
    cc: 'DO',
    langs: ['es', 'en'],
    locale: 'es',
    color: '#2A6F6B',
    verified: 'unverified',
  });

  // 10. HISTORIAL DE CARGOS / ASIGNACIONES
  const assignments = [
    ['card_valerio', 'dicasterio-evangelizacion', 'Cardenal Pro-Prefecto', 2022, null, true, true],
    ['card_valerio', 'dicasterio-obispos', 'Miembro del Dicasterio', 2020, null, true, false],
    ['card_valerio', 'arcidiocesi-milano', 'Obispo Auxiliar', 2012, 2020, false, false],

    ['mons_rafael_sd', 'arquidiocesis-santo-domingo', 'Arzobispo Metropolitano', 2020, null, true, true],
    ['mons_rafael_sd', 'ced-republica-dominicana', 'Presidente del Consejo Permanente', 2023, null, true, false],
    ['mons_rafael_sd', 'diocesis-bani', 'Obispo Diocesano', 2014, 2020, false, false],
    ['mons_rafael_sd', 'seminario-santo-tomas-aquino', 'Rector', 2007, 2014, false, false],

    ['mons_gabriel_higuey', 'diocesis-higuey', 'Obispo Diocesano', 2021, null, true, true],
    ['mons_gabriel_higuey', 'basilica-altagracia-higuey', 'Custodio del Santuario Nacional', 2021, null, true, false],
    ['mons_gabriel_higuey', 'arquidiocesis-santiago-rd', 'Vicario General', 2015, 2021, false, false],

    ['p_mateo_catedral', 'catedral-primada-america', 'Párroco Rector', 2021, null, true, true],
    ['p_mateo_catedral', 'seminario-santo-tomas-aquino', 'Profesor de Teología Sacramental', 2018, null, true, false],
    ['p_mateo_catedral', 'parroquia-san-judas-tadeo-sd', 'Vicario Parroquial', 2011, 2017, false, false],

    ['mons_alvaro_madrid', 'arquidiocesis-madrid', 'Arzobispo Metropolitano', 2021, null, true, true],
    ['mons_alvaro_madrid', 'cee-espana', 'Miembro de la Comisión Ejecutiva', 2022, null, true, false],
    ['mons_alvaro_madrid', 'diocesis-getafe', 'Obispo Auxiliar', 2015, 2021, false, false],

    ['abp_thomas_ny', 'archdiocese-new-york', 'Metropolitan Archbishop', 2019, null, true, true],
    ['abp_thomas_ny', 'usccb-usa', 'Committee on Doctrine Member', 2020, null, true, false],
    ['abp_thomas_ny', 'diocese-brooklyn', 'Auxiliary Bishop', 2013, 2019, false, false],

    ['p_ignacio_sj', 'basilica-guadalupe-mx', 'Capellán del Santuario', 2022, null, true, true],
    ['p_ignacio_sj', 'compania-de-jesus-sj', 'Presbítero Profeso (SJ)', 2014, null, true, false],

    ['don_marco_mi', 'duomo-milano', 'Canonico del Capitolo Metropolitano', 2019, null, true, true],
    ['diac_lucas_ba', 'arquidiocesis-buenos-aires', 'Diácono Permanente — Pastoral Social', 2018, null, true, true],
    ['maria_esperanza', 'catedral-primada-america', 'Miembro del Coro Litúrgico', 2019, null, true, true],
  ];

  for (const [uname, unitSlug, role, sy, ey, curr, prim] of assignments) {
    await pool.query(
      `INSERT INTO user_assignments (user_id, unit_id, role_title, start_year, end_year, is_current, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userIds[uname], unitIds[unitSlug], role, sy, ey, curr, prim]
    );
  }

  // 11. PUBLICACIONES DEL CLERO (Multilingüe y por niveles jerárquicos)
  const samplePosts = [
    {
      author: 'card_valerio',
      scope: 'santa-sede',
      type: 'pastoral_letter',
      title: 'Comunión visible en la era digital: un solo cuerpo, muchas diócesis',
      content:
        'Hermanos obispos, sacerdotes, diáconos y fieles de todo el mundo: la comunión eclesial se fortalece cuando cada comunidad local reconoce su vínculo vivo con su obispo y con la Sede de Pedro. Que este espacio sirva para anunciar el Evangelio con caridad, rigor y esperanza.',
      scripture: 'Jn 17, 21',
      lang: 'es',
      pinned: true,
      hoursAgo: 2,
    },
    {
      author: 'mons_rafael_sd',
      scope: 'arquidiocesis-santo-domingo',
      type: 'decree',
      title: 'Convocatoria a la Asamblea Sinodal Arquidiocesana 2026',
      content:
        'Convocamos a todos los párrocos, vicarios, diáconos, vida consagrada y consejos parroquiales de la Arquidiócesis de Santo Domingo a participar en la jornada de oración y discernimiento pastoral en la Catedral Primada de América el próximo sábado a las 9:00 a.m.',
      scripture: 'Hch 2, 42',
      eventLocation: 'Catedral Primada de América, Santo Domingo',
      lang: 'es',
      pinned: true,
      hoursAgo: 5,
    },
    {
      author: 'p_mateo_catedral',
      scope: 'catedral-primada-america',
      type: 'homily',
      title: 'Homilía: Permanecer en el amor que transforma la ciudad',
      content:
        'Cada mañana, al abrir las puertas centenarias de nuestra Catedral Primada, recordamos que la Iglesia no son solo piedras venerables: es el Pueblo de Dios que camina, escucha la Palabra y parte el Pan para llevar consuelo a los que sufren. Hoy rezamos especialmente por las familias de nuestra parroquia y por todas las diócesis hermanas.',
      scripture: 'Jn 15, 9-12',
      lang: 'es',
      hoursAgo: 8,
    },
    {
      author: 'mons_gabriel_higuey',
      scope: 'diocesis-higuey',
      type: 'announcement',
      title: 'Peregrinación Diocesana hacia la Basílica de Nuestra Señora de la Altagracia',
      content:
        'Invitamos a todas las parroquias de la Diócesis de Higüey y a los peregrinos del país a unirse a la Vigilia Mariana este viernes desde las 7:00 p.m. Tendremos confesiones continuas, Santo Rosario por la paz y Eucaristía solemne.',
      scripture: 'Lc 1, 46-49',
      eventLocation: 'Basílica Catedral de Higüey',
      lang: 'es',
      hoursAgo: 12,
    },
    {
      author: 'abp_thomas_ny',
      scope: 'archdiocese-new-york',
      type: 'reflection',
      title: 'Unity in Diversity Across Every Parish',
      content:
        'Across the boroughs and valleys of the Archdiocese of New York, the Mass is celebrated every Sunday in over twenty languages. Yet it is the very same Eucharistic table that unites us with Rome, Santo Domingo, Manila, Milan, and Paris. Let us pray for one another today.',
      scripture: '1 Cor 10, 17',
      lang: 'en',
      hoursAgo: 15,
    },
    {
      author: 'mons_alvaro_madrid',
      scope: 'arquidiocesis-madrid',
      type: 'event',
      title: 'Vigilia de Adoración Vocacional en la Catedral de la Almudena',
      content:
        'Este jueves a las 20:30 nos reunimos los jóvenes, seminaristas y sacerdotes de Madrid junto a las diócesis hermanas de Getafe y Alcalá para pedir al Dueño de la mies que envíe obreros a su mies.',
      scripture: 'Mt 9, 37-38',
      eventLocation: 'Catedral de la Almudena, Madrid',
      lang: 'es',
      hoursAgo: 20,
    },
    {
      author: 'p_ignacio_sj',
      scope: 'compania-de-jesus-sj',
      type: 'reflection',
      title: 'Discernimiento cotidiano: buscar y hallar a Dios en todas las cosas',
      content:
        'San Ignacio nos invita a examinar el día no desde la culpa, sino desde la gratitud. ¿Dónde sentiste hoy consolación y paz profunda? Allí te hablaba el Señor. Desde el Tepeyac enviamos nuestra bendición a las comunidades jesuitas y parroquias de toda América.',
      scripture: 'Flp 1, 9-10',
      lang: 'es',
      hoursAgo: 26,
    },
    {
      author: 'don_marco_mi',
      scope: 'arcidiocesi-milano',
      type: 'homily',
      title: 'La bellezza della liturgia ambrosiana come porta verso il mistero',
      content:
        'Nel cuore di Milano, tra il ritmo veloce della città moderna, il canto liturgico e il silenzio adorante nel Duomo ci ricordano che siamo pellegrini verso l’eterno. Un saluto fraterno a tutti i presbiteri collegati su Credo.',
      scripture: 'Sal 27, 4',
      lang: 'it',
      hoursAgo: 30,
    },
    {
      author: 'diac_lucas_ba',
      scope: 'arquidiocesis-buenos-aires',
      type: 'announcement',
      title: 'Jornada de Cáritas y asistencia a familias en situación de calle',
      content:
        'Este sábado desde las 16 hs estaremos recibiendo abrigos y alimentos no perecederos en los centros parroquiales de la Arquidiócesis de Buenos Aires. Gracias a cada voluntario que hace visible la caridad de Cristo.',
      scripture: 'Mt 25, 40',
      lang: 'es',
      hoursAgo: 35,
    },
  ];

  const postIds = [];
  for (const p of samplePosts) {
    const res = await pool.query(
      `INSERT INTO posts (
         author_id, scope_unit_id, post_type, title, content,
         scripture_ref, event_location, language, is_pinned, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() - ($10 || ' hours')::interval)
       RETURNING id`,
      [
        userIds[p.author],
        unitIds[p.scope],
        p.type,
        p.title,
        p.content,
        p.scripture || '',
        p.eventLocation || '',
        p.lang || 'es',
        Boolean(p.pinned),
        String(p.hoursAgo || 1),
      ]
    );
    postIds.push(res.rows[0].id);
  }

  // Reacciones y comentarios iniciales
  const seedReactions = [
    [postIds[0], 'mons_rafael_sd', 'amen'],
    [postIds[0], 'p_mateo_catedral', 'amen'],
    [postIds[0], 'maria_esperanza', 'amen'],
    [postIds[0], 'maria_esperanza', 'pray'],
    [postIds[0], 'abp_thomas_ny', 'gratitude'],
    [postIds[1], 'p_mateo_catedral', 'amen'],
    [postIds[1], 'mons_gabriel_higuey', 'pray'],
    [postIds[1], 'maria_esperanza', 'gratitude'],
    [postIds[2], 'maria_esperanza', 'amen'],
    [postIds[2], 'mons_rafael_sd', 'gratitude'],
    [postIds[3], 'maria_esperanza', 'pray'],
  ];
  for (const [pid, uname, rtype] of seedReactions) {
    await pool.query(
      `INSERT INTO post_reactions (post_id, user_id, reaction_type)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [pid, userIds[uname], rtype]
    );
  }

  const seedComments = [
    [
      postIds[0],
      'mons_rafael_sd',
      'Gracias Eminencia por estas palabras de comunión. Desde la Sede Primada de América nos unimos en oración por la Iglesia universal.',
    ],
    [
      postIds[0],
      'maria_esperanza',
      '¡Amén! Qué bendición poder leer directamente a nuestros obispos y sacerdotes unidos en un solo lugar.',
    ],
    [
      postIds[2],
      'maria_esperanza',
      'Hermosa homilía Padre Mateo. El coro ya está ensayando los cantos para la misa dominical.',
    ],
    [
      postIds[1],
      'p_mateo_catedral',
      'Todo preparado en la Catedral Primada para recibir a los hermanos sacerdotes y delegados parroquiales, Monseñor.',
    ],
  ];
  for (const [pid, uname, content] of seedComments) {
    await pool.query(
      `INSERT INTO post_comments (post_id, author_id, content) VALUES ($1,$2,$3)`,
      [pid, userIds[uname], content]
    );
  }

  // 12. GRUPOS PASTORALES POR UNIDAD ECLESIÁSTICA + CHAT DIRECTO DEMO
  const pastoralGroups = [
    {
      unit: 'santa-sede',
      title: 'Comunión Universal — Santa Sede',
      desc: 'Espacio internacional de oración, noticias pastorales y diálogo entre comunidades de los cinco continentes.',
      creator: 'card_valerio',
      members: ['card_valerio', 'mons_rafael_sd', 'mons_alvaro_madrid', 'abp_thomas_ny', 'p_mateo_catedral', 'maria_esperanza'],
      welcome: 'Bienvenidos al canal de comunión universal de Credo. Oremos juntos por la unidad de la Iglesia.',
    },
    {
      unit: 'arquidiocesis-santo-domingo',
      title: 'Pastoral Arquidiócesis de Santo Domingo',
      desc: 'Coordinación pastoral, parroquias, movimientos y anuncios de la Arquidiócesis de Santo Domingo.',
      creator: 'mons_rafael_sd',
      members: ['mons_rafael_sd', 'p_mateo_catedral', 'mons_gabriel_higuey', 'maria_esperanza'],
      welcome: 'Paz y bien a todos los hermanos de la Arquidiócesis de Santo Domingo. Aquí coordinamos la agenda sinodal.',
    },
    {
      unit: 'catedral-primada-america',
      title: 'Comunidad Catedral Primada de América',
      desc: 'Parroquianos, coro, catequistas y clero de la Catedral Primada en Santo Domingo.',
      creator: 'p_mateo_catedral',
      members: ['p_mateo_catedral', 'maria_esperanza', 'mons_rafael_sd'],
      welcome: '¡Bienvenidos a la comunidad parroquial de la Catedral Primada! Misa diaria a las 7:00 a.m. y 5:00 p.m.',
    },
    {
      unit: 'arquidiocesis-madrid',
      title: 'Pastoral Archidiócesis de Madrid',
      desc: 'Encuentro de sacerdotes, diáconos y fieles de Madrid.',
      creator: 'mons_alvaro_madrid',
      members: ['mons_alvaro_madrid', 'card_valerio'],
      welcome: 'Un saludo fraterno desde Madrid. Recordad la vigilia vocacional en la Almudena.',
    },
    {
      unit: 'archdiocese-new-york',
      title: 'Archdiocese of New York — Pastoral Circle',
      desc: 'Clergy and faithful fellowship across the parishes of New York.',
      creator: 'abp_thomas_ny',
      members: ['abp_thomas_ny', 'card_valerio'],
      welcome: 'Peace be with you! Welcome to the pastoral group of the Archdiocese of New York.',
    },
  ];

  for (const g of pastoralGroups) {
    const convRes = await pool.query(
      `INSERT INTO conversations (kind, title, description, unit_id, created_by)
       VALUES ('pastoral_group', $1, $2, $3, $4) RETURNING id`,
      [g.title, g.desc, unitIds[g.unit], userIds[g.creator]]
    );
    const cid = convRes.rows[0].id;
    for (const uname of g.members) {
      await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [cid, userIds[uname], uname === g.creator ? 'moderator' : 'member']
      );
    }
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)`,
      [cid, userIds[g.creator], g.welcome]
    );
  }

  // Un mensaje directo de ejemplo entre P. Mateo y María Esperanza
  const dmRes = await pool.query(
    `INSERT INTO conversations (kind, title, created_by) VALUES ('direct', '', $1) RETURNING id`,
    [userIds['maria_esperanza']]
  );
  const dmId = dmRes.rows[0].id;
  await pool.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`,
    [dmId, userIds['maria_esperanza'], userIds['p_mateo_catedral']]
  );
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3)`,
    [dmId, userIds['maria_esperanza'], 'Buenas tardes Padre Mateo, ¿confirmamos el ensayo del coro este viernes a las 6:00 p.m.?']
  );
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3)`,
    [dmId, userIds['p_mateo_catedral'], '¡Sí, María! Confirmado a las 6:00 p.m. en la sacristía mayor. Bendiciones.']
  );

  // Follows iniciales para que la pestaña "Siguiendo" tenga contenido inmediato
  const seedFollows = [
    ['maria_esperanza', 'card_valerio'],
    ['maria_esperanza', 'mons_rafael_sd'],
    ['maria_esperanza', 'p_mateo_catedral'],
    ['p_mateo_catedral', 'card_valerio'],
    ['p_mateo_catedral', 'mons_rafael_sd'],
    ['p_mateo_catedral', 'mons_gabriel_higuey'],
  ];
  for (const [f, t] of seedFollows) {
    await pool.query(
      `INSERT INTO follows (follower_id, target_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [userIds[f], userIds[t]]
    );
  }

  console.log('[seed] Worldwide ecclesiastical hierarchy seeded successfully.');
}

async function seedVisualsAndStories() {
  // Backfill high-resolution photography on seeded posts that have no image_url yet
  const photoByAuthor = {
    card_valerio: 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=1080&q=80',
    mons_rafael_sd: 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1080&q=80',
    p_mateo_catedral: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=1080&q=80',
    mons_gabriel_higuey: 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?auto=format&fit=crop&w=1080&q=80',
    abp_thomas_ny: 'https://images.unsplash.com/photo-1543716091-a840c05249ec?auto=format&fit=crop&w=1080&q=80',
    mons_alvaro_madrid: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=1080&q=80',
    p_ignacio_sj: 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?auto=format&fit=crop&w=1080&q=80',
    don_marco_mi: 'https://images.unsplash.com/photo-1513581166391-887a96ddeafd?auto=format&fit=crop&w=1080&q=80',
    diac_lucas_ba: 'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?auto=format&fit=crop&w=1080&q=80',
  };

  for (const [username, url] of Object.entries(photoByAuthor)) {
    await pool.query(
      `UPDATE posts p
          SET image_url = $1
         FROM users u
        WHERE p.author_id = u.id
          AND u.username = $2
          AND COALESCE(p.image_url, '') = ''`,
      [url, username]
    );
  }

  // Seed sample Clergy Stories if empty
  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM stories WHERE expires_at > NOW()');
  if (rows[0].cnt === 0) {
    const sampleStories = [
      {
        username: 'card_valerio',
        image: 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=900&q=80',
        caption: 'Desde la Plaza de San Pedro, oremos hoy por todas las diócesis y parroquias del mundo.',
        scripture: 'Jn 17, 21',
        grad: 'linear-gradient(145deg,#8B1E3F,#3D0A19)',
      },
      {
        username: 'mons_rafael_sd',
        image: 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=900&q=80',
        caption: 'Asamblea Sinodal Arquidiocesana en la Catedral Primada de América. ¡Los esperamos!',
        scripture: 'Hch 2, 42',
        grad: 'linear-gradient(145deg,#5C2350,#260D21)',
      },
      {
        username: 'p_mateo_catedral',
        image: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=900&q=80',
        caption: 'Eucaristía matutina en la Catedral Primada. Hoy ofrecemos la misa por todas las familias.',
        scripture: 'Jn 15, 9',
        grad: 'linear-gradient(145deg,#1F2937,#0F172A)',
      },
      {
        username: 'mons_gabriel_higuey',
        image: 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?auto=format&fit=crop&w=900&q=80',
        caption: 'Vigilia Mariana este viernes en la Basílica de Nuestra Señora de la Altagracia.',
        scripture: 'Lc 1, 46',
        grad: 'linear-gradient(145deg,#1D4E89,#0F2544)',
      },
      {
        username: 'abp_thomas_ny',
        image: 'https://images.unsplash.com/photo-1543716091-a840c05249ec?auto=format&fit=crop&w=900&q=80',
        caption: 'Evening Vespers at St. Patrick’s Cathedral. United in prayer with our global Church.',
        scripture: '1 Cor 10, 17',
        grad: 'linear-gradient(145deg,#4C1D43,#1E0B1B)',
      },
      {
        username: 'p_ignacio_sj',
        image: 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?auto=format&fit=crop&w=900&q=80',
        caption: 'Ejercicios Espirituales en la vida diaria · Buscar y hallar a Dios en todas las cosas.',
        scripture: 'Flp 1, 9',
        grad: 'linear-gradient(145deg,#3B2F2F,#1A1414)',
      },
    ];

    for (const s of sampleStories) {
      await pool.query(
        `INSERT INTO stories (author_id, scope_unit_id, image_url, caption, scripture_ref, bg_gradient, expires_at)
         SELECT id, primary_unit_id, $2, $3, $4, $5, NOW() + INTERVAL '30 days'
           FROM users WHERE username = $1 LIMIT 1`,
        [s.username, s.image, s.caption, s.scripture, s.grad]
      );
    }
    console.log('[seed] Visual photography and clergy stories initialized.');
  }
}

async function seedCredoEcosystem() {
  // 0. Ensure CEO User: P. Domingo Vásquez (owner of aire96fm.com.do & reflexionandolapalabra.com)
  const domUnitRes = await pool.query(
    `SELECT id FROM ecclesiastical_units
      WHERE slug IN ('arq-santo-domingo', 'parroquia-catedral-sd') OR country_code = 'DO'
      ORDER BY CASE WHEN unit_type = 'archdiocese' THEN 1 ELSE 2 END, id ASC
      LIMIT 1`
  );
  const domUnitId = domUnitRes.rows[0]?.id || null;
  const ceoPassHash = await bcrypt.hash('Credo2026!', 10);
  const ceoLinks = JSON.stringify([
    {
      label: 'Aire 96 FM',
      url: 'https://aire96fm.com.do',
      role: 'Propietario & Director · Emisora en Vivo',
    },
    {
      label: 'Reflexionando la Palabra',
      url: 'https://reflexionandolapalabra.com',
      role: 'Propietario & Director · Evangelio Diario',
    },
  ]);

  const ceoRes = await pool.query(
    `INSERT INTO users (
       email, password_hash, username, full_name, title_prefix,
       ecclesiastical_rank, primary_unit_id, current_office_title,
       bio, motto, country_code, languages, preferred_locale,
       avatar_color, avatar_url, verification_status, verification_note,
       is_admin, is_ceo, is_credo_plus, credo_plus_plan, website_links
     ) VALUES (
       'padre.domingo@credo.org', $1, 'p_domingo_vasquez', 'Domingo Vásquez', 'P.',
       'priest', $2, 'CEO de Credo · Propietario de Aire 96 FM y Reflexionando la Palabra',
       'Sacerdote católico, CEO de Credo y propietario de Aire 96 FM (aire96fm.com.do) y Reflexionando la Palabra (reflexionandolapalabra.com). Comprometido con la evangelización digital, la radio católica en vivo y la cercanía pastoral para toda la Iglesia.',
       'Llevando la Palabra de Dios al aire y a cada corazón',
       'DO', ARRAY['es','en'], 'es',
       '#0F1E36', 'https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png',
       'verified', 'CEO & Fundador verificado',
       TRUE, TRUE, TRUE, 'annual', $3::jsonb
     )
     ON CONFLICT (username) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       title_prefix = EXCLUDED.title_prefix,
       current_office_title = EXCLUDED.current_office_title,
       bio = EXCLUDED.bio,
       motto = EXCLUDED.motto,
       avatar_url = EXCLUDED.avatar_url,
       verification_status = 'verified',
       is_admin = TRUE,
       is_ceo = TRUE,
       is_credo_plus = TRUE,
       credo_plus_plan = 'annual',
       website_links = EXCLUDED.website_links
     RETURNING id`,
    [ceoPassHash, domUnitId, ceoLinks]
  );
  const ceoId = ceoRes.rows[0].id;

  // Ensure CEO has a pinned welcome post featuring Aire 96 FM & Reflexionando la Palabra
  const ceoPostPhoto = 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1080&q=80';
  const ceoStoryPhoto = 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=900&q=80';
  const { rows: ceoPostCheck } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM posts WHERE author_id = $1',
    [ceoId]
  );
  if (ceoPostCheck[0].cnt === 0) {
    await pool.query(
      `INSERT INTO posts (
         author_id, scope_unit_id, post_type, title, content, image_url,
         media_kind, scripture_ref, language, is_pinned
       ) VALUES (
         $1, $2, 'pastoral_letter',
         'Bienvenidos a Credo · Aire 96 FM y Reflexionando la Palabra ahora en vivo',
         'Hermanos y hermanas, con inmensa alegría inauguramos Credo: un espacio sereno, verificado y universal para vivir la fe en comunión. Desde hoy pueden escuchar en vivo la señal oficial de Aire 96 FM (aire96fm.com.do) y meditar cada día con Reflexionando la Palabra (reflexionandolapalabra.com) desde cualquier lugar del mundo.',
         $3,
         'article', 'Mc 16, 15', 'es', TRUE
       )`,
      [ceoId, domUnitId, ceoPostPhoto]
    );
  } else {
    await pool.query(
      `UPDATE posts SET image_url = $1 WHERE author_id = $2 AND image_url LIKE '%aire96fm.com.do/wp-content/uploads/%'`,
      [ceoPostPhoto, ceoId]
    );
  }

  // Ensure CEO has an official story
  const { rows: ceoStoryCheck } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM stories WHERE author_id = $1 AND expires_at > NOW()',
    [ceoId]
  );
  if (ceoStoryCheck[0].cnt === 0) {
    await pool.query(
      `INSERT INTO stories (author_id, scope_unit_id, image_url, caption, scripture_ref, bg_gradient, expires_at)
       VALUES (
         $1, $2,
         $3,
         '¡Aire 96 FM está EN VIVO ahora mismo en Credo! Escucha nuestra señal oficial y acompaña la Palabra cada día.',
         'Sal 19, 5',
         'linear-gradient(145deg,#0F1E36,#3D2C0A)',
         NOW() + INTERVAL '30 days'
       )`,
      [ceoId, domUnitId, ceoStoryPhoto]
    );
  } else {
    await pool.query(
      `UPDATE stories SET image_url = $1 WHERE author_id = $2 AND image_url LIKE '%aire96fm.com.do/wp-content/uploads/%'`,
      [ceoStoryPhoto, ceoId]
    );
  }

  // 1. Upsert Live Radio & TV Channels (with REAL live stream for Aire 96 FM!)
  await pool.query("DELETE FROM live_channels WHERE slug = 'radio-abc'");
  const channels = [
    {
      slug: 'aire-96',
      name: 'Aire 96 FM',
      kind: 'radio',
      tagline: 'Emisora oficial de P. Domingo Vásquez · aire96fm.com.do',
      current_program: 'Señal Oficial en Directo · Aire 96 FM',
      host_name: 'P. Domingo Vásquez (CEO)',
      frequency: '96.5 FM · EN VIVO',
      country_code: 'DO',
      city: 'República Dominicana',
      accent_color: '#C8A253',
      cover_url: 'https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png',
      stream_url: 'https://paginas.moisespaulino.com/proxy/moises2020/stream',
      is_hero: true,
      listeners_count: 5480,
      sort_order: 1,
    },
    {
      slug: 'reflexionando-la-palabra',
      name: 'Reflexionando la Palabra',
      kind: 'radio',
      tagline: 'reflexionandolapalabra.com · Por P. Domingo Vásquez',
      current_program: 'Reflexión del Evangelio del Día · En Vivo',
      host_name: 'P. Domingo Vásquez (CEO)',
      frequency: 'Audio HD · Oficial',
      country_code: 'DO',
      city: 'República Dominicana',
      accent_color: '#6D4C2F',
      cover_url: 'https://reflexionandolapalabra.com/wp-content/themes/reflexionando/assets/img/favicon-512.png',
      stream_url: 'https://paginas.moisespaulino.com/proxy/moises2020/stream',
      is_hero: false,
      listeners_count: 3420,
      sort_order: 2,
    },
    {
      slug: 'televida-live',
      name: 'Televida Canal 41',
      kind: 'tv',
      tagline: 'El Canal Católico de la Familia · Transmisión en Directo',
      current_program: 'Santa Misa desde la Catedral Primada de América',
      host_name: 'Mons. Rafael Herrera & P. Mateo Rojas',
      frequency: 'Canal 41 HD',
      country_code: 'DO',
      city: 'Santo Domingo',
      accent_color: '#0F1E36',
      cover_url: 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1080&q=80',
      stream_url: '',
      youtube_live_id: 'jfKfPfyJRdk',
      is_hero: false,
      listeners_count: 4280,
      sort_order: 3,
    },
    {
      slug: 'vida-fm',
      name: 'Vida FM 105.3',
      kind: 'radio',
      tagline: 'Música Católica Contemporánea, Adoración y Palabra 24/7',
      current_program: 'Alabanza Matutina en Vivo',
      host_name: 'Equipo Vida FM',
      frequency: '105.3 FM',
      country_code: 'DO',
      city: 'Santo Domingo',
      accent_color: '#8B2635',
      cover_url: 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?auto=format&fit=crop&w=800&q=80',
      stream_url: '',
      is_hero: false,
      listeners_count: 2610,
      sort_order: 4,
    },
    {
      slug: 'radio-vaticano-es',
      name: 'Radio Vaticano · Español',
      kind: 'radio',
      tagline: 'Noticias de la Santa Sede, Ángelus y Audiencias Generales',
      current_program: 'Crónica Vaticana y Mensaje del Santo Padre',
      host_name: 'Vatican News',
      frequency: 'Ciudad del Vaticano',
      country_code: 'VA',
      city: 'Ciudad del Vaticano',
      accent_color: '#7A1C2E',
      cover_url: 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=800&q=80',
      stream_url: '',
      is_hero: false,
      listeners_count: 5420,
      sort_order: 6,
    },
    {
      slug: 'ewtn-espanol-tv',
      name: 'EWTN Español TV',
      kind: 'tv',
      tagline: 'Santa Misa Diaria, Adoración Eucarística Perpetua y Formación',
      current_program: 'Adoración al Santísimo desde la Capilla',
      host_name: 'Red Católica Mundial',
      frequency: 'TV HD',
      country_code: 'US',
      city: 'Irondale / Miami',
      accent_color: '#1D3557',
      cover_url: 'https://images.unsplash.com/photo-1543716091-a840c05249ec?auto=format&fit=crop&w=1080&q=80',
      stream_url: '',
      youtube_live_id: '5qap5aO4i9A',
      is_hero: false,
      listeners_count: 3890,
      sort_order: 7,
    },
    {
      slug: 'vatican-media-live',
      name: 'Vatican Media Live',
      kind: 'tv',
      tagline: 'Plaza de San Pedro · Celebraciones Litúrgicas en Directo',
      current_program: 'Cámara en Directo · Basílica de San Pedro',
      host_name: 'Dicasterio para la Comunicación',
      frequency: '4K Live',
      country_code: 'VA',
      city: 'Ciudad del Vaticano',
      accent_color: '#5C4724',
      cover_url: 'https://images.unsplash.com/photo-1513581166391-887a96ddeafd?auto=format&fit=crop&w=1080&q=80',
      stream_url: '',
      youtube_live_id: 'jfKfPfyJRdk',
      is_hero: false,
      listeners_count: 6120,
      sort_order: 8,
    },
  ];

  for (const ch of channels) {
    await pool.query(
      `INSERT INTO live_channels (
         slug, name, kind, tagline, current_program, host_name, frequency,
         country_code, city, accent_color, cover_url, stream_url, youtube_live_id,
         is_hero, is_live, listeners_count, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         tagline = EXCLUDED.tagline,
         current_program = EXCLUDED.current_program,
         host_name = EXCLUDED.host_name,
         frequency = EXCLUDED.frequency,
         country_code = EXCLUDED.country_code,
         city = EXCLUDED.city,
         accent_color = EXCLUDED.accent_color,
         cover_url = EXCLUDED.cover_url,
         stream_url = EXCLUDED.stream_url,
         is_hero = EXCLUDED.is_hero,
         sort_order = EXCLUDED.sort_order`,
      [
        ch.slug,
        ch.name,
        ch.kind,
        ch.tagline,
        ch.current_program,
        ch.host_name,
        ch.frequency,
        ch.country_code,
        ch.city,
        ch.accent_color,
        ch.cover_url,
        ch.stream_url || '',
        ch.youtube_live_id || '',
        ch.is_hero,
        ch.listeners_count,
        ch.sort_order,
      ]
    );
  }
  console.log('[seed] CEO P. Domingo Vásquez & live channels (Aire 96 FM live stream) synced.');

  // 2. Seed official YouTube-synced video posts if none exist
  const { rows: videoCount } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM posts WHERE media_kind = 'video'"
  );
  if (videoCount[0].cnt === 0) {
    const videoPosts = [
      {
        username: 'mons_rafael_sd',
        post_type: 'homily',
        title: 'Homilía Dominical: «Permanezcan en mi amor» · Catedral Primada',
        content:
          'Reflexión dominical grabada desde la Catedral Primada de América. Un llamado a renovar la vida parroquial desde la cercanía, la escucha y la Eucaristía compartida en familia.',
        image_url: 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1080&q=80',
        youtube_id: 'dQw4w9WgXcQ',
        video_duration: '14:28',
        channel_name: 'Televida Oficial · YouTube',
        scripture_ref: 'Jn 15, 9–17',
      },
      {
        username: 'card_valerio',
        post_type: 'pastoral_letter',
        title: 'Mensaje desde Roma: La Iglesia digital al servicio de la comunión',
        content:
          'Cómo las diócesis, parroquias y medios católicos oficiales pueden acompañar a jóvenes y adultos mayores con claridad, belleza y fidelidad al Evangelio.',
        image_url: 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=1080&q=80',
        youtube_id: 'aqz-KE-bpKQ',
        video_duration: '08:42',
        channel_name: 'Vatican News Español · YouTube',
        scripture_ref: '1 Cor 12, 12',
      },
      {
        username: 'p_ignacio_sj',
        post_type: 'reflection',
        title: '5 minutos de Lectio Divina para comenzar el día en paz',
        content:
          'Guía breve y contemplativa para orar con el Evangelio antes de iniciar la jornada. Ideal para escuchar camino al trabajo o en un momento de silencio en casa.',
        image_url: 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?auto=format&fit=crop&w=1080&q=80',
        youtube_id: 'M7lc1UVf-VE',
        video_duration: '05:16',
        channel_name: 'Reflexionando la Palabra · YouTube',
        scripture_ref: 'Sal 23, 1–3',
      },
    ];

    for (const vp of videoPosts) {
      await pool.query(
        `INSERT INTO posts (
           author_id, scope_unit_id, post_type, title, content, image_url,
           media_kind, youtube_id, video_duration, channel_name, scripture_ref, language
         )
         SELECT id, primary_unit_id, $2, $3, $4, $5, 'video', $6, $7, $8, $9, 'es'
           FROM users WHERE username = $1 LIMIT 1`,
        [
          vp.username,
          vp.post_type,
          vp.title,
          vp.content,
          vp.image_url,
          vp.youtube_id,
          vp.video_duration,
          vp.channel_name,
          vp.scripture_ref,
        ]
      );
    }
    console.log('[seed] Official YouTube-synced video posts seeded.');
  }

  // 3. Backfill Mass & Confession Schedules, Photos & Notices on Parishes/Dioceses
  const defaultMass = JSON.stringify([
    { day: 'Lunes a Viernes', times: ['7:00 AM', '12:00 PM', '6:30 PM'] },
    { day: 'Sábados', times: ['8:00 AM', '5:00 PM (Víspera)', '7:00 PM'] },
    { day: 'Domingos', times: ['8:00 AM', '10:00 AM (Familia)', '12:00 PM', '6:00 PM'] },
  ]);
  const defaultConfessions = JSON.stringify([
    { day: 'Martes y Jueves', times: ['4:30 PM – 6:15 PM'] },
    { day: 'Sábados', times: ['9:00 AM – 11:30 AM', '4:00 PM – 6:00 PM'] },
  ]);
  const defaultNotices = JSON.stringify([
    {
      title: 'Adoración al Santísimo este Jueves',
      date: 'Jueves · 7:30 PM',
      detail: 'Hora Santa cantada por las familias y las vocaciones sacerdotales.',
    },
    {
      title: 'Inscripciones abiertas · Catequesis y Confirmación',
      date: 'Secretaría Parroquial',
      detail: 'Atención de lunes a viernes de 9:00 AM a 5:00 PM o desde tu perfil en Credo.',
    },
  ]);

  await pool.query(
    `UPDATE ecclesiastical_units
        SET mass_schedule = CASE WHEN jsonb_array_length(mass_schedule) = 0 THEN $1::jsonb ELSE mass_schedule END,
            confession_schedule = CASE WHEN jsonb_array_length(confession_schedule) = 0 THEN $2::jsonb ELSE confession_schedule END,
            notices = CASE WHEN jsonb_array_length(notices) = 0 THEN $3::jsonb ELSE notices END,
            image_url = CASE WHEN COALESCE(image_url, '') = '' THEN
              CASE unit_type
                WHEN 'holy_see' THEN 'https://images.unsplash.com/photo-1531572753322-ad063cecc140?auto=format&fit=crop&w=1080&q=80'
                WHEN 'archdiocese' THEN 'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1080&q=80'
                WHEN 'diocese' THEN 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?auto=format&fit=crop&w=1080&q=80'
                ELSE 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=1080&q=80'
              END
            ELSE image_url END,
            phone = CASE WHEN COALESCE(phone, '') = '' THEN '+1 (809) 555-0148' ELSE phone END`,
    [defaultMass, defaultConfessions, defaultNotices]
  );

  // 4. Seed Prayer Intentions Wall (idempotent)
  const { rows: prayerCount } = await pool.query('SELECT COUNT(*)::int AS cnt FROM prayer_intentions');
  if (prayerCount[0].cnt === 0) {
    const unitRes = await pool.query(
      "SELECT id FROM ecclesiastical_units WHERE unit_type = 'parish' ORDER BY id ASC LIMIT 5"
    );
    const parishIds = unitRes.rows.map((r) => r.id);
    const pickUnit = (i) => (parishIds.length > 0 ? parishIds[i % parishIds.length] : null);

    const intentions = [
      {
        author: 'Carmen Delgado',
        anon: false,
        cat: 'urgent',
        urgent: true,
        count: 148,
        content:
          'Pido sus oraciones urgentes por mi madre Doña Elena, quien entra a cirugía del corazón mañana a las 7:00 AM. Que el Señor guíe las manos de los médicos y le dé paz.',
      },
      {
        author: 'Fiel anónimo',
        anon: true,
        cat: 'family',
        urgent: false,
        count: 92,
        content:
          'Por la reconciliación y unidad de mi matrimonio. Atravesamos un momento difícil, pero confiamos en la gracia de Dios y la intercesión de la Sagrada Familia.',
      },
      {
        author: 'Luis Fernando M.',
        anon: false,
        cat: 'vocation',
        urgent: false,
        count: 64,
        content:
          'Por todos los seminaristas que este semestre discernirán su llamado al sacerdocio en nuestra Arquidiócesis, y por la perseverancia de nuestros párrocos.',
      },
      {
        author: 'Rosaura Peña',
        anon: false,
        cat: 'gratitude',
        urgent: false,
        count: 117,
        content:
          'Doy infinitas gracias a Dios y a la Virgen de la Altagracia porque mi hijo recibió su alta médica tras tres semanas en cuidados intensivos. ¡El Señor es fiel!',
      },
      {
        author: 'Fiel anónimo',
        anon: true,
        cat: 'urgent',
        urgent: true,
        count: 203,
        content:
          'Por un hermano joven de nuestra comunidad parroquial que lucha contra la depresión y la soledad. Que sienta el abrazo vivo de Cristo y de la Iglesia hoy.',
      },
      {
        author: 'Familia Castellanos',
        anon: false,
        cat: 'peace',
        urgent: false,
        count: 175,
        content:
          'Unimos nuestro Rosario de hoy por la paz en el mundo, por los cristianos perseguidos y por las familias migrantes que buscan un hogar digno.',
      },
      {
        author: 'Ana Sofía V.',
        anon: false,
        cat: 'health',
        urgent: false,
        count: 83,
        content:
          'Por la pronta recuperación del P. Antonio, párroco emérito que dedicó 48 años a nuestra diócesis y hoy necesita de nuestra cercanía y oración.',
      },
      {
        author: 'Marcos & Lucía',
        anon: false,
        cat: 'family',
        urgent: false,
        count: 59,
        content:
          'Agradecemos sus oraciones por el bebé que esperamos con tanta ilusión para noviembre. Que nazca sano y crezca en la fe.',
      },
    ];

    for (let i = 0; i < intentions.length; i++) {
      const it = intentions[i];
      await pool.query(
        `INSERT INTO prayer_intentions (unit_id, author_display, is_anonymous, category, is_urgent, content, prayers_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' hours')::interval)`,
        [pickUnit(i), it.author, it.anon, it.cat, it.urgent, it.content, it.count, String(i * 3 + 1)]
      );
    }
    console.log('[seed] Prayer intentions wall seeded.');
  }
}

async function purgeMockDataAndSyncReal() {
  const { syncOfficialSources } = require('../utils/officialSync');

  // 1. Delete all mock/demo users (cascades to their mock posts, comments, reactions, stories, messages, follows)
  const mockUsernames = [
    'card_valerio',
    'mons_rafael_sd',
    'p_mateo_catedral',
    'mons_gabriel_higuey',
    'abp_thomas_ny',
    'mons_alvaro_madrid',
    'p_ignacio_sj',
    'don_marco_mi',
    'diac_lucas_ba',
    'maria_laica',
  ];
  await pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [mockUsernames]);

  // 2. Delete mock stories, mock conversations with no real messages, mock YouTube/placeholder posts, and mock prayers
  await pool.query("DELETE FROM stories WHERE caption LIKE '%Aire 96 FM está EN VIVO%' OR caption LIKE '%Plaza de San Pedro%' OR caption LIKE '%Asamblea Sinodal%' OR caption LIKE '%Eucaristía matutina%' OR caption LIKE '%Vigilia Mariana%' OR caption LIKE '%Evening Vespers%' OR caption LIKE '%Ejercicios Espirituales%'");
  await pool.query("DELETE FROM posts WHERE title = 'Bienvenidos a Credo · Aire 96 FM y Reflexionando la Palabra ahora en vivo' OR youtube_id IN ('dQw4w9WgXcQ','aqz-KE-bpKQ','M7lc1UVf-VE')");
  await pool.query("DELETE FROM prayer_intentions WHERE author_display IN ('Carmen Delgado','Luis Fernando M.','Rosaura Peña','Familia Castellanos','Ana Sofía V.','Marcos & Lucía') OR (user_id IS NULL AND author_display = 'Fiel anónimo' AND prayers_count >= 50)");
  await pool.query('DELETE FROM conversations WHERE created_by IS NULL');

  // 3. Remove invented mock radio/TV channels — keep ONLY real Aire 96 FM & Reflexionando la Palabra
  await pool.query("DELETE FROM live_channels WHERE slug NOT IN ('aire-96', 'reflexionando-la-palabra')");

  // 4. Clear invented mock Mass/Confession schedules, notices, and fake phone from ecclesiastical_units
  await pool.query(
    `UPDATE ecclesiastical_units
        SET mass_schedule = '[]'::jsonb,
            confession_schedule = '[]'::jsonb,
            notices = '[]'::jsonb,
            phone = CASE WHEN phone = '+1 (809) 555-0148' THEN '' ELSE phone END`
  );

  // 5. Ensure real CEO account: P. Domingo Vásquez
  const domUnitRes = await pool.query(
    `SELECT id FROM ecclesiastical_units
      WHERE slug IN ('arq-santo-domingo', 'parroquia-catedral-sd') OR country_code = 'DO'
      ORDER BY CASE WHEN unit_type = 'archdiocese' THEN 1 ELSE 2 END, id ASC
      LIMIT 1`
  );
  const domUnitId = domUnitRes.rows[0]?.id || null;
  const ceoPassHash = await bcrypt.hash('Credo2026!', 10);
  const ceoLinks = JSON.stringify([
    {
      label: 'Aire 96 FM',
      url: 'https://aire96fm.com.do',
      role: 'Propietario & Director · Emisora en Vivo',
    },
    {
      label: 'Reflexionando la Palabra',
      url: 'https://reflexionandolapalabra.com',
      role: 'Propietario & Director · Evangelio Diario',
    },
  ]);

  await pool.query(
    `INSERT INTO users (
       email, password_hash, username, full_name, title_prefix,
       ecclesiastical_rank, primary_unit_id, current_office_title,
       bio, motto, country_code, languages, preferred_locale,
       avatar_color, avatar_url, verification_status, verification_note,
       is_admin, is_ceo, is_credo_plus, credo_plus_plan, website_links
     ) VALUES (
       'padre.domingo@credo.org', $1, 'p_domingo_vasquez', 'Domingo Vásquez', 'P.',
       'priest', $2, 'CEO de Credo · Propietario de Aire 96 FM y Reflexionando la Palabra',
       'Sacerdote católico, CEO de Credo y propietario de Aire 96 FM (aire96fm.com.do) y Reflexionando la Palabra (reflexionandolapalabra.com).',
       'Llevando la Palabra de Dios al aire y a cada corazón',
       'DO', ARRAY['es'], 'es',
       '#0F1E36', 'https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png',
       'verified', 'CEO & Fundador verificado',
       TRUE, TRUE, TRUE, 'annual', $3::jsonb
     )
     ON CONFLICT (username) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       title_prefix = EXCLUDED.title_prefix,
       current_office_title = EXCLUDED.current_office_title,
       bio = EXCLUDED.bio,
       motto = EXCLUDED.motto,
       avatar_url = EXCLUDED.avatar_url,
       verification_status = 'verified',
       is_admin = TRUE,
       is_ceo = TRUE,
       is_credo_plus = TRUE,
       credo_plus_plan = 'annual',
       website_links = EXCLUDED.website_links`,
    [ceoPassHash, domUnitId, ceoLinks]
  );

  // 6. Upsert ONLY real live radio channels
  const realChannels = [
    {
      slug: 'aire-96',
      name: 'Aire 96 FM',
      kind: 'radio',
      tagline: 'Emisora oficial de P. Domingo Vásquez · aire96fm.com.do',
      current_program: 'Señal Oficial en Directo · Aire 96 FM',
      host_name: 'P. Domingo Vásquez',
      frequency: '96.5 FM · EN VIVO',
      country_code: 'DO',
      city: 'República Dominicana',
      accent_color: '#C8A253',
      cover_url: 'https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png',
      stream_url: 'https://paginas.moisespaulino.com/proxy/moises2020/stream',
      is_hero: true,
      listeners_count: 0,
      sort_order: 1,
    },
    {
      slug: 'reflexionando-la-palabra',
      name: 'Reflexionando la Palabra',
      kind: 'radio',
      tagline: 'reflexionandolapalabra.com · Por P. Domingo Vásquez',
      current_program: 'Liturgia y Palabra del Día',
      host_name: 'P. Domingo Vásquez',
      frequency: 'Audio Oficial',
      country_code: 'DO',
      city: 'República Dominicana',
      accent_color: '#6D4C2F',
      cover_url: 'https://reflexionandolapalabra.com/wp-content/themes/reflexionando/assets/img/favicon-512.png',
      stream_url: 'https://paginas.moisespaulino.com/proxy/moises2020/stream',
      is_hero: false,
      listeners_count: 0,
      sort_order: 2,
    },
  ];

  for (const ch of realChannels) {
    await pool.query(
      `INSERT INTO live_channels (
         slug, name, kind, tagline, current_program, host_name, frequency,
         country_code, city, accent_color, cover_url, stream_url, youtube_live_id,
         is_hero, is_live, listeners_count, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,TRUE,$14,$15)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         tagline = EXCLUDED.tagline,
         current_program = EXCLUDED.current_program,
         host_name = EXCLUDED.host_name,
         frequency = EXCLUDED.frequency,
         country_code = EXCLUDED.country_code,
         city = EXCLUDED.city,
         accent_color = EXCLUDED.accent_color,
         cover_url = EXCLUDED.cover_url,
         stream_url = EXCLUDED.stream_url,
         is_hero = EXCLUDED.is_hero,
         listeners_count = EXCLUDED.listeners_count,
         sort_order = EXCLUDED.sort_order`,
      [
        ch.slug,
        ch.name,
        ch.kind,
        ch.tagline,
        ch.current_program,
        ch.host_name,
        ch.frequency,
        ch.country_code,
        ch.city,
        ch.accent_color,
        ch.cover_url,
        ch.stream_url,
        ch.is_hero,
        ch.listeners_count,
        ch.sort_order,
      ]
    );
  }

  // 7. Fetch & sync real live articles from aire96fm.com.do & reflexionandolapalabra.com
  await syncOfficialSources();
  console.log('[seed] All mock data purged; CEO P. Domingo Vásquez, Aire 96 FM live stream & real official feeds ready.');
}

module.exports = { seedIfEmpty, seedVisualsAndStories, seedCredoEcosystem, purgeMockDataAndSyncReal };


