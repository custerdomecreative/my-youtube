// Which stories make up "today's paper". Shared by the front page (Today) and the News edition so both always
// show the same stories and the same count. Pure functions: callers pass in what's been read and saved.
//
// The paper leans towards actual news: RTÉ, BBC World and the NYT make up the paper, plus at most one rugby or
// football story from BBC Sport and one from VGC. The Verge and the rest of the sport (cricket, golf, ...) stay
// in All stories. Both extras are newest-first picks, so a quiet day simply has fewer.
const Paper = (() => {
  const HOURS = 24;
  const NEWS_SOURCES = new Set(["RTÉ News", "BBC World", "NYT"]);
  const WANTED_SPORT = /\b(rugby|six nations|munster|leinster|ulster|connacht|urc|champions cup|british and irish lions|all blacks|springboks|football|premier league|champions league|europa league|fa cup|league cup|carabao cup|world cup|league of ireland|women's super league|arsenal|aston villa|celtic|chelsea|everton|liverpool|manchester (city|united)|man (city|utd|united)|newcastle united|tottenham|spurs|west ham)\b/i;
  const OTHER_SPORT = /\b(cricket|ashes|test match|ipl|golf|tennis|f1|formula (1|one)|snooker|darts|boxing|ufc|cycling|athletics|nfl|nba|mlb|nhl)\b/i;
  const wantedSport = s => { const t = `${s.title} ${s.summary || ""}`; return WANTED_SPORT.test(t) && !(OTHER_SPORT.test(t) && !/\b(rugby|football)\b/i.test(t)); };
  const newest = (a, b) => (a.published < b.published ? 1 : -1);
  const inWindow = stories => stories.filter(s => !s.published || Date.now() - new Date(s.published) < HOURS * 3600000);
  // Stories from the last day that you haven't read or saved for later, newest first.
  function recent(stories, read, laterIds) {
    return inWindow(stories).filter(s => !read.has(s.id) && !laterIds.has(s.id)).sort(newest);
  }
  // The edition is chosen from the day's stories as if nothing had been read, and only then are the ones you've
  // read or saved taken out. So finishing the VGC story doesn't bring in a second one: the paper only gets shorter.
  function todaysPaper(stories, read, laterIds) {
    const list = inWindow(stories).sort(newest);
    const news = list.filter(s => NEWS_SOURCES.has(s.source));
    const sport = list.find(s => s.source === "BBC Sport" && wantedSport(s));
    const games = list.find(s => s.source === "VGC");
    return [...news, ...[sport, games].filter(Boolean)].filter(s => !read.has(s.id) && !laterIds.has(s.id)).sort(newest);
  }
  return { NEWS_SOURCES, recent, todaysPaper };
})();
