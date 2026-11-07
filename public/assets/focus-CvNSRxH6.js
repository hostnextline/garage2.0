let e=null;function r(t){e=t}function n(){if(!e)return;const t=e;e=null,requestAnimationFrame(()=>{try{document.querySelector(t)?.focus({preventScroll:!0})}catch{}})}export{r as f,n as r};
