let profile = {
  name:null, language:'swedish', gender:null, birthYear:null,
  level:null, weeklySessions:null, current5kTime:null,
  injuryNotes:null, raceComingUp:null, raceDate:null, raceDistance:null,
  agent:'coach', profileComplete:false, conversationSummary:''
};

export const get = () => ({ ...profile });
export const patch = (partial) => { profile = { ...profile, ...partial }; };
export const setSummary = (s) => { profile.conversationSummary = s || ''; };
export const isComplete = () => {
  const req = ['name','gender','birthYear','level','weeklySessions','current5kTime'];
  return req.every(k => !!profile[k]);
};
