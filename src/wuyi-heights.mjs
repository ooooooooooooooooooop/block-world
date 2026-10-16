const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

// Evidence-bearing overrides for the Wuyi sample. Heights from plans or floor
// counts remain explicitly reviewable; these values are not survey results.
export const HEIGHT_DECISIONS = deepFreeze({
  '527545453': {
    name: 'Changsha IFS Tower T1', sourceHeightMeters: 452, sourceLevels: 93,
    heightMeters: 452.1, levels: 94, decision: 'ctbuh-as-built', reviewRequired: false,
    heightBasis: 'CTBUH/CVU architectural height; completed building record', confidence: 'high',
    evidenceURL: 'https://www.skyscrapercenter.com/building/changsha-ifs-tower-t1/13144',
    evidenceDate: 'completed 2018; page accessed 2026-10-15',
    evidence: 'Height 452.1 m; 94 floors above ground; status Completed.',
    identity: 'OSM feature is named Changsha IFS Tower T1 and has the matching T1 footprint.'
  },
  '527545451': {
    name: 'Changsha IFS Tower T2', sourceHeightMeters: 315, sourceLevels: 65,
    heightMeters: 308, levels: 63, decision: 'ctbuh-as-built-over-design-sources', reviewRequired: false,
    heightBasis: 'CTBUH/CVU completed-building architectural height', confidence: 'high',
    evidenceURL: 'https://www.skyscrapercenter.com/building/changsha-ifs-tower-t2/13145',
    evidenceDate: 'completed 2018; page accessed 2026-10-15',
    evidence: 'The completed T2 record gives 308 m and 63 floors. 2017 construction/design material gives 315 m/63 floors; Inhabit lists 330 m as project design data.',
    secondaryEvidence: [
      'https://sstr.cscec.com/hxgg31/qywh31/qykw31/201707/P020180105515223047163.pdf',
      'https://inhabitgroup.com/project/changsha-ifs/?desktop_mode=true'
    ],
    identity: 'OSM name and footprint identify the completed Changsha IFS Tower T2 at 188 West Jiefang Road.'
  },
  '543405242': {
    name: 'Shimao Global Financial Center', sourceHeightMeters: 420, sourceLevels: 80,
    heightMeters: 343, levels: 74, decision: 'ctbuh-as-built-owner-confirmed', reviewRequired: false,
    heightBasis: 'CTBUH/CVU completed-building architectural height, corroborated by developer', confidence: 'high',
    evidenceURL: 'https://www.skyscrapercenter.com/building/shimao-global-financial-center/15373',
    secondaryEvidence: ['https://www.shimaogroup.com/smlist/view.php?aid=721', 'https://commons.wikimedia.org/wiki/Category:Shimao_Hunan_Center'],
    evidenceDate: 'completed 2019; page accessed 2026-10-15',
    evidence: 'CTBUH records 343 m, 74 floors, completed; Shimao describes the project as about 343 m.',
    identity: 'The OSM 15-point footprint center (112.978553, 28.196903) is within about 10 m of the Shimao Hunan Center mapped point (112.978619, 28.196819); the developer identifies the project at Furong Square southwest corner / Jianxiang Road 393.'
  },
  '543405244': {
    name: 'Taizhen International Finance Center / Hunan Investment Tower', sourceHeightMeters: 420, sourceLevels: 82,
    heightMeters: 160, levels: 36, decision: 'developer-project-spec-needs-as-built-check', reviewRequired: true,
    heightBasis: 'developer-announced project height and levels; not an as-built survey', confidence: 'medium-high',
    evidenceURL: 'https://hn.rednet.cn/c/2013/10/28/4260160.htm',
    secondaryEvidence: [
      'https://epaper.stcn.com/paper/zqsb/page/1/2014-12/20/B041/20141220B041_pdf.pdf',
      'https://epaper.stcn.com/paper/zqsb/html/2016-05/06/content_822336.htm',
      'https://www.icswb.com/h/100036/20170804/484426.html'
    ],
    evidenceDate: 'Rednet 2013-10-28; Hunan Investment filing 2014-12-20; operational/property evidence 2016-05-06 and 2017-08-04',
    evidence: 'The 2013 groundbreaking report says 160 m, 36 above-ground floors and four basement floors; 2014 company filing locates it at Wuyi Avenue/Jianxiang Middle Road southwest corner and says 36 floors.',
    identity: 'The six-point OSM footprint center (112.978386, 28.197781) matches the southwest corner location at Wuyi Avenue and Jianxiang Road; later records call the project Hunan Investment Tower.'
  },
  '273260867': {
    name: '万代大酒店（万代广场）', sourceHeightMeters: null, sourceLevels: null,
    heightMeters: 60, levels: 15, decision: 'historical-plan-height-needs-built-survey', reviewRequired: true,
    heightBasis: '1995 planning specification; completion status/height not independently surveyed', confidence: 'medium',
    evidenceURL: 'https://hunan.gov.cn/hnszf/szf/hnzb_18/zb9506/202106/19441758/files/197603dbd4bc47659b5fcfb9a632a2d3.pdf',
    evidenceDate: 'Hunan Gazette 1995 issue 6 (PDF hosted/uploaded 2021); planned completion 1997',
    evidence: 'The gazette project entry specifies 60 m and 15 floors, with completion expected in 1997; current as-built height was not verified.',
    identity: 'OSM feature name 万代大酒店; historical planning entry refers to the Wuyi commercial-area hotel project.'
  },
  '273260769': {
    name: 'New World Department Store', sourceHeightMeters: null, sourceLevels: null,
    heightMeters: 31.5, levels: 7, decision: 'owner-floor-count-derived-estimate', reviewRequired: true,
    heightBasis: 'owner-announced seven-storey mall × assumed 4.5 m per floor; estimate only', confidence: 'low',
    evidenceURL: 'https://www.nwd.com.hk/content/nwds-announces-acquisition-changsha-trendy-plaza',
    evidenceDate: 'New World Development acquisition announcement; page publication date not exposed in retrieved text',
    evidence: 'The owner describes the acquired Changsha Trendy Plaza as a seven-storey department store; 31.5 m is a floor-count estimate, not a measured height.',
    identity: 'OSM feature name and Wikidata/Wikipedia links identify the Changsha New World Department Store.'
  },
  '87058059': {
    name: 'New World Mansion', sourceHeightMeters: null, sourceLevels: null,
    heightMeters: 87.5, levels: 25, decision: 'reported-floor-count-derived-estimate', reviewRequired: true,
    heightBasis: '25 above-ground floors × assumed 3.5 m per floor; estimate only', confidence: 'medium-low',
    evidenceURL: 'https://m.voc.com.cn/xhn/news/202204/14750797.html',
    evidenceDate: '2022-04-11',
    evidence: 'The report states 27 floors including two basement floors, with floors 1–25 above ground and hotel/office use on floors 6–25; 87.5 m is derived, not measured.',
    identity: 'OSM feature name 新世界大厦 matches the asset named in the auction report for the former Crowne Plaza site.'
  },
  '52072595': {
    name: 'Heiwado Department Store podium', sourceHeightMeters: 40, sourceLevels: 6,
    heightMeters: 40, levels: 6, decision: 'retain-podium-source-office-tower-unmapped', reviewRequired: true,
    heightBasis: 'retain OSM polygon height for the six-storey commercial podium; separate 28th-floor office tower has no verified footprint/height', confidence: 'medium',
    evidenceURL: 'https://heiwado.cn/WB9001.aspx',
    secondaryEvidence: ['https://www.gkintl.com.cn/nd.jsp?id=180'],
    evidenceDate: 'Owner company overview; property owner leasing post 2025-09-19',
    evidence: 'Heiwado reports 79,419 m² of retail and 32,400 m² of office space; Guokai International offers space on the 28th floor. This proves the OSM 40 m/6-floor polygon is not a complete office-tower model, but gives no measured tower height.',
    identity: 'OSM feature is named 平和堂百货 at Huangxing Middle Road 88; owner describes the integrated Heiwado commercial/office complex.'
  }
});

function positiveNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([+]?(?:\d+\.?\d*|\.\d+))\s*(?:m|米)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildingId(building) {
  if (typeof building === 'string' || typeof building === 'number') return String(building);
  if (!building || typeof building !== 'object') return '';
  const id = building.id ?? building.osmId ?? building.osm_id ?? building.tags?.['@id'];
  if (id == null) return '';
  return String(id).replace(/^(?:way|relation|node)\//, '');
}

function sourceHeight(building, known) {
  const candidates = [
    building?.sourceHeightMeters,
    building?.heightTag,
    building?.tags?.height,
    building?.rawHeightTag,
    building?.height,
    building?.heightMeters
  ];
  for (const candidate of candidates) {
    const value = positiveNumber(candidate);
    if (value != null) return value;
  }
  return known?.sourceHeightMeters ?? null;
}

function sourceLevels(building, known) {
  const candidates = [
    building?.sourceLevels,
    building?.levelsTag,
    building?.tags?.['building:levels'],
    building?.rawBuildingLevelsTag,
    building?.levels
  ];
  for (const candidate of candidates) {
    const value = positiveNumber(candidate);
    if (value != null) return value;
  }
  return known?.sourceLevels ?? null;
}

export function resolveWuyiHeight(building) {
  const id = buildingId(building);
  const known = HEIGHT_DECISIONS[id];
  const sourceHeightMeters = sourceHeight(building, known);
  const originalLevels = sourceLevels(building, known);
  if (known) {
    return {
      heightMeters: known.heightMeters,
      levels: known.levels,
      sourceHeightMeters,
      decision: known.decision,
      reviewRequired: known.reviewRequired
    };
  }
  if (sourceHeightMeters != null) {
    return {
      heightMeters: sourceHeightMeters,
      levels: originalLevels,
      sourceHeightMeters,
      decision: /estimate/.test(building?.heightSource ?? '') ? 'retain-processed-estimate-needs-review' : sourceHeightMeters >= 300 ? 'retain-source-needs-identity-review' : 'retain-source',
      reviewRequired: /estimate/.test(building?.heightSource ?? '') || sourceHeightMeters >= 300
    };
  }
  return {
    heightMeters: 6,
    levels: originalLevels,
    sourceHeightMeters: null,
    decision: 'default-no-valid-source-height',
    reviewRequired: true
  };
}
