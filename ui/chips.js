import { scrollFollow } from './scroll.js';

export function render(bubbleEl, options, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'chip-row';
  options.forEach(opt => {
    const label = String(opt);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach(b => b.disabled = true);
      onPick?.(label);
      wrap.remove();
    });
    wrap.appendChild(btn);
  });
  (bubbleEl || document.getElementById('messages')).appendChild(wrap);
  scrollFollow(true);
}
