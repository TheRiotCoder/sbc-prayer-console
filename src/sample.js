
// Placeholder items used ONLY when every live source in a category is unavailable. They are generic, make no factual
// claims about any event, and every one is flagged example:true and rendered with an EXAMPLE badge.
const T = {
  persecution: [
    ['Example item: persecution news feed is currently unavailable', 'Placeholder shown because no live persecution-news source responded. Use the Open Doors World Watch List countries on the map for prayer in the meantime.'],
    ['Example item: remember those in prison for their faith (Hebrews 13:3)', 'Placeholder prayer prompt, not a news report.'],
  ],
  missions: [
    ['Example item: missions feed is currently unavailable', 'Placeholder shown because IMB/NAMB feeds did not respond. Visit imb.org or namb.net directly.'],
    ['Example item: pray for laborers to be sent into the harvest (Matthew 9:37-38)', 'Placeholder prayer prompt, not a news report.'],
  ],
  sbc: [
    ['Example item: SBC news feed is currently unavailable', 'Placeholder shown because Baptist Press / SBC.net did not provide items. Visit baptistpress.com directly.'],
  ],
};
function items(cat) {
  return (T[cat] || T.persecution).map(([title, excerpt], i) => ({ id: 'example:' + cat + i, source: 'example', sourceName: 'EXAMPLE DATA (no live source available)', category: cat,
    title, link: '', published: null, excerpt, tags: ['example'], countries: [], example: true }));
}
export { items };
