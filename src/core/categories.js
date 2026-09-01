// 티스토리 카테고리 목표 구조와, 글감 카테고리 → 티스토리 카테고리 매핑.
// 자동 발행은 auto:true 인 카테고리에만 글을 올린다.

/** 최종 목표 구조. 카테고리 재편 모듈이 이 정의를 기준으로 생성/삭제한다. */
export const TARGET_TREE = [
  {
    name: '생활의 성장',
    children: [
      { name: '지원금·환급',   auto: true },
      { name: '절약·생활금융', auto: true },
      { name: '생활정보·서류', auto: true },
    ],
  },
  {
    // 직접 쓰시는 영역. 자동 발행 대상이 아니다.
    name: '부의 성장',
    children: [
      { name: '투자공부', auto: false },
      { name: '시황분석', auto: false },
      { name: '투자철학', auto: false },
    ],
  },
];

/** 제거 대상. 글이 들어있으면 삭제하지 않고 경고만 남긴다. */
export const REMOVE = ['성장하는 라이프', '포토그래피', '러닝라이프', '지식의 성장', '독서노트'];

/** DB keywords.category → 티스토리 카테고리 이름 */
export const KEYWORD_TO_TISTORY = {
  정책지원금: '지원금·환급',
  세금환급:   '지원금·환급',
  생활금융:   '절약·생활금융',
  생활정보:   '생활정보·서류',
  리뷰쇼핑:   null, // 애드센스 승인 후 카테고리를 만들고 연결한다
};

/**
 * 승인을 거쳐 추가된 카테고리는 DB(state.extra_categories)에 쌓인다.
 * 코드(TARGET_TREE)를 고치지 않고도 목표 구조가 확장되게 하기 위함이다.
 * 형태: [{ name, parent, auto, keywordCategory }]
 */
export function extraCategories(getState) {
  try { return JSON.parse(getState('extra_categories', '[]')); } catch { return []; }
}

/** TARGET_TREE + 승인된 추가분을 합친 최종 목표 구조. */
export function effectiveTree(getState) {
  const tree = TARGET_TREE.map((p) => ({ ...p, children: [...p.children] }));
  for (const e of extraCategories(getState)) {
    const parent = tree.find((p) => p.name === e.parent);
    if (parent) { if (!parent.children.some((c) => c.name === e.name)) parent.children.push({ name: e.name, auto: e.auto !== false }); }
    else if (!tree.some((p) => p.name === e.name)) tree.push({ name: e.name, children: [] });
  }
  return tree;
}

/** 승인된 매핑을 합친 글감→티스토리 카테고리 표. */
export function effectiveMapping(getState) {
  const map = { ...KEYWORD_TO_TISTORY };
  for (const e of extraCategories(getState)) if (e.keywordCategory) map[e.keywordCategory] = e.name;
  return map;
}

export const autoCategories = () =>
  TARGET_TREE.flatMap((p) => p.children.filter((c) => c.auto).map((c) => c.name));

export const flatTarget = () =>
  TARGET_TREE.flatMap((p) => [{ name: p.name, parent: null }, ...p.children.map((c) => ({ name: c.name, parent: p.name, auto: c.auto }))]);

/** 발행 가능한 글감인지 (매핑이 있고 자동 발행 대상인지) */
export const isPublishable = (keywordCategory) => {
  const t = KEYWORD_TO_TISTORY[keywordCategory];
  return Boolean(t && autoCategories().includes(t));
};
