#!/bin/bash
# Le pouls du serveur du garage. Vérifie que :
#   1. l'app en ligne répond (version.json sur Vercel) ;
#   2. la base répond (health()) et a la dernière migration du code ;
#   3. chaque fonction du serveur répond (GET …/<fonction>?version) depuis un commit qui contient son code ;
#   4. la sauvegarde de la nuit a fini il y a moins de 30 heures.
# Usage : bash ops/pouls.sh                 le ping de GitHub (toutes les 6 h) : 1, 2 et 3 doivent répondre, 4 est exigé ;
#         bash ops/pouls.sh --publication   avant de publier l'app : la base et les fonctions doivent être au niveau du
#                                           code (sinon : appliquer la migration / redéployer la fonction, puis relancer).
# Rien n'est écrit nulle part. La clé publique (anon) est celle de l'app, dans chaque téléphone.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP=${APP_URL:-https://mecanique-mobile-his.vercel.app}
SB=${SUPABASE_URL:-https://wyxvizxabqgvsiiemvfw.supabase.co}
KEY=${SUPABASE_ANON_KEY:-sb_publishable_Pzvp2qqc8Y52meAZkczSSg_trH2ZTTA}
MODE=${1:-ping}
erreurs=0
ko(){ echo "✗ $*"; erreurs=$((erreurs + 1)); }
ok(){ echo "✓ $*"; }
attention(){ echo "! $*"; }
js(){ node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log('')}})" "$1"; }

# 1. l'app
v=$(curl -sS --max-time 20 "$APP/version.json?t=$(date +%s)" || true)
ver=$(printf '%s' "$v" | js 'j.version || ""')
if [ -n "$ver" ]; then ok "l'app répond (version ${ver:0:7}, faite le $(printf '%s' "$v" | js 'j.built_at || "?"'))"; else ko "l'app ne répond pas ($APP) : $(printf '%s' "$v" | head -c 200)"; fi

# 2. la base
h=$(curl -sS --max-time 25 "$SB/rest/v1/rpc/health" -H "apikey: $KEY" -H "authorization: Bearer $KEY" || true)
if [ "$(printf '%s' "$h" | js 'j.ok === true')" != "true" ]; then
  ko "la base ne répond pas (projet en pause ? health() absente ?) : $(printf '%s' "$h" | head -c 200)"
else
  schema=$(printf '%s' "$h" | js 'j.schema || ""')
  code=$(ls supabase/migrations/*.sql | sort | tail -1 | xargs basename | cut -c1-14)
  if [ -z "$schema" ]; then ko "health() ne dit pas la version de la base"
  elif [ "$schema" \< "$code" ]; then
    if [ "$MODE" = "--publication" ]; then ko "la base est à $schema, le code demande $code : applique la migration (CLAUDE.md, sha256), puis relance la publication (Actions → Publier l'app → Run workflow)"
    else attention "la base est à $schema, le code demande $code (migration pas encore appliquée)"; fi
  else ok "la base répond, migration $schema"; fi
  # 4. la sauvegarde
  done_at=$(printf '%s' "$h" | js 'j.backup_done || ""')
  age=$(printf '%s' "$h" | js 'j.backup_done ? Math.round((Date.now() - Date.parse(j.backup_done)) / 3600000) : -1')
  if [ "$age" = "-1" ]; then msg="aucune sauvegarde finie connue (health().backup_done vide)"; else msg="dernière sauvegarde finie il y a $age h ($done_at, $(printf '%s' "$h" | js 'j.backup_rows || ""'))"; fi
  if [ "$age" = "-1" ] || [ "$age" -gt 30 ]; then
    if [ "$MODE" = "--publication" ]; then attention "$msg"; else ko "$msg : voir le dépôt des sauvegardes (Actions → Sauvegarde du garage)"; fi
  else ok "$msg"; fi
fi

# 3. les fonctions
for d in supabase/functions/*/; do
  f=$(basename "$d"); [ "${f:0:1}" = "_" ] && continue
  r=$(curl -sS --max-time 25 "$SB/functions/v1/$f?version" -H "apikey: $KEY" -H "authorization: Bearer $KEY" || true)
  commit=$(printf '%s' "$r" | js 'j.ok === true ? (j.commit || "") : ""')
  if [ -z "$commit" ]; then ko "la fonction $f ne répond pas à ?version : $(printf '%s' "$r" | head -c 160)"; continue; fi
  if [ "$MODE" = "--publication" ]; then
    full=$(git rev-parse --verify -q "$commit^{commit}" || true)
    last=$(git log -1 --format=%H -- "supabase/functions/$f" supabase/functions/_shared)
    if [ -z "$full" ]; then ko "la fonction $f tourne depuis un commit inconnu ici ($commit)"
    elif git merge-base --is-ancestor "$last" "$full"; then ok "la fonction $f tourne depuis ${commit:0:7} (son code n'a pas changé depuis)"
    else ko "la fonction $f tourne depuis ${commit:0:7} mais son code a changé dans ${last:0:7} : redéploie-la (CLAUDE.md), puis relance la publication"; fi
  else ok "la fonction $f répond (commit ${commit:0:7})"; fi
done

if [ "$erreurs" -gt 0 ]; then echo; echo "$erreurs problème(s)."; exit 1; fi
echo; echo "Tout répond."
