// 발행 스타일 팔레트.
//
// 색은 SEO 에 영향이 없다. 구글은 시맨틱 구조·모바일 사용성·콘텐츠를 본다.
// 따라서 색 선택 기준은 가독성과 인상뿐이다.
//
// 공통 규칙 (다크모드 대응):
//  · 본문·제목 글자색은 지정하지 않고 스킨에서 상속받는다
//  · 강조색은 '선'과 '표 헤더'에만 쓴다 → 대비 문제에서 자유롭고 더 절제돼 보인다
//  · 배경·테두리는 rgba 반투명

const common = {
  zebra:  'rgba(128,128,128,0.09)',
  border: 'rgba(128,128,128,0.32)',
};

export const PALETTES = {
  // 지금 쓰는 것 — 제목까지 파랑
  blue: {
    label: '현재 (블루)',
    desc: '제목까지 파랑. 선명하지만 정보성 글에는 다소 가벼움',
    accent: '#3b82f6', headingColor: '#3b82f6',
    headBg: '#1e40af', headText: '#ffffff',
    softBg: 'rgba(59,130,246,0.08)', ...common,
  },

  // 모노톤 에디토리얼 — 색을 거의 안 쓴다
  slate: {
    label: '슬레이트 (모노톤)',
    desc: '제목은 본문색, 색은 얇은 선과 표 헤더에만. 가장 절제되고 신뢰감 있는 인상',
    accent: '#64748b', headingColor: null,
    headBg: '#334155', headText: '#ffffff',
    softBg: 'rgba(100,116,139,0.10)', ...common,
  },

  // 잉크 + 앰버 — 따뜻한 포인트
  amber: {
    label: '잉크 + 앰버',
    desc: '먹색 표 헤더에 앰버 포인트. 매거진 같은 따뜻하고 고급스러운 느낌',
    accent: '#d97706', headingColor: null,
    headBg: '#44403c', headText: '#fafaf9',
    softBg: 'rgba(217,119,6,0.09)', ...common,
  },

  // 딥 그린 — 차분함
  forest: {
    label: '포레스트 (딥그린)',
    desc: '깊은 초록. 금융·행정 정보와 잘 어울리고 눈이 편함',
    accent: '#0d9488', headingColor: null,
    headBg: '#134e4a', headText: '#ffffff',
    softBg: 'rgba(13,148,136,0.09)', ...common,
  },
};

export const DEFAULT_PALETTE = 'blue';
