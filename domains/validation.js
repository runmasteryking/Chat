export function normalize(key, raw){
  const s = String(raw||'').trim();
  switch(key){
    case 'name':           return s && s.length<=50 ? s : null;
    case 'gender': {
      const g = s.toLowerCase();
      if (['male','man','m','kille','pojke','herr','h'].includes(g)) return 'male';
      if (['female','woman','f','tjej','flicka','dam','d'].includes(g)) return 'female';
      if (['other','annan','övrigt','non-binary','nb'].includes(g)) return 'other';
      return null;
    }
    case 'birthYear': {
      const y = parseInt(s,10); return (y>=1940 && y<=2015) ? y : null;
    }
    case 'level': {
      const l = s.toLowerCase();
      if (['beginner','nybörjare'].includes(l)) return 'beginner';
      if (['intermediate','medel','medelvan'].includes(l)) return 'intermediate';
      if (['advanced','avancerad','erfaren'].includes(l)) return 'advanced';
      return null;
    }
    case 'weeklySessions': {
      const n = parseInt(s,10); return (n>=1 && n<=14) ? n : null;
    }
    case 'current5kTime': {
      const t = s.replace(/\s+/g,'');
      const mmss = /^[0-5]?\d:[0-5]\d$/;
      const hmmss = /^\d{1,2}:[0-5]?\d:[0-5]\d$/;
      if (mmss.test(t)) return `00:${t.padStart(5,'0')}`;
      if (hmmss.test(t)) return t.split(':').map(p=>p.padStart(2,'0')).join(':');
      return null;
    }
    default: return s || null;
  }
}
