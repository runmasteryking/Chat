export function scrollFollow(smooth=false){
  const el = document.getElementById('messages');
  if (!el) return;
  if (smooth && 'scrollTo' in el) el.scrollTo({ top: el.scrollHeight, behavior:'smooth' });
  else el.scrollTop = el.scrollHeight;
}
