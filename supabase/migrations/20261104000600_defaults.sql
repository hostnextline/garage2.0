-- Part 6: the starting settings (blocks, driving estimates, texts sent to customers, the waiver), the same for every copy.
-- The garage's own data (name, numbers, prices, trucks) is in supabase/seed.sql, loaded once on the real project.
update public.settings set
  booking = jsonb_build_object(
    'blocks', '[{"key":"am","start":480,"end":720},{"key":"pm","start":720,"end":960},{"key":"eve","start":960,"end":1200}]'::jsonb,
    'horizon_days', 120, 'speed_kmh', 35, 'detour', 1.3, 'stop_min', 5, 'unknown_min', 20, 'min_block_min', 45, 'near_km', 5,
    'home', '{"label":"Centrale","address":"8255 av. Mountain Sights, Montréal, QC H4P 2B5","lat":45.5005053,"lng":-73.6577429}'::jsonb
  ) || booking,
  billing = jsonb_build_object('invoice_prefix', 'F-', 'pad', 4, 'due_days', 0, 'hourly_cents', null, 'travel', '{"cents":0,"free_over_cents":null}'::jsonb) || billing,
  taxes = '{"enabled": true, "tps": 0.05, "tvq": 0.09975}'::jsonb || taxes,
  messages = jsonb_build_object(
    'on', '{"booking":true,"moved":true,"en_route":true,"invoice":true,"extras":true,"reminder":false}'::jsonb,
    'fr', jsonb_build_object(
      'booking', 'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, entre {debut} et {fin}. Total prévu : {total} (taxes incluses). Détails : {lien}',
      'moved', 'Bonjour {prenom}, votre rendez-vous avec {garage} a changé : {jour}, entre {debut} et {fin}. Détails : {lien}',
      'en_route', 'Bonjour {prenom}, {mecano} de {garage} est en route vers chez vous : arrivée prévue vers {heure} (environ {minutes} min). Suivez son trajet en direct : {lien}',
      'en_route_no_eta', 'Bonjour {prenom}, {mecano} de {garage} est en route vers chez vous. Suivez son trajet en direct : {lien}',
      'invoice', 'Bonjour {prenom}, voici votre facture {numero} de {garage} ({total}) : {lien}',
      'extras', 'Bonjour {prenom}, {mecano} de {garage} propose des travaux supplémentaires sur votre {vehicule} ({montant} avant taxes). Pour voir et accepter ou refuser : {lien}',
      'reminder', 'Rappel : {garage} vient demain, {jour}, entre {debut} et {fin}. Pour changer : {telephone}',
      'payment_reminder', 'Bonjour {prenom}, petit rappel de {garage} : la facture {numero} du {date} ({montant}) est toujours à payer. {lien}'),
    'en', jsonb_build_object(
      'booking', 'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, between {debut} and {fin}. Expected total: {total} (taxes included). Details: {lien}',
      'moved', 'Hello {prenom}, your appointment with {garage} has changed: {jour}, between {debut} and {fin}. Details: {lien}',
      'en_route', 'Hello {prenom}, {mecano} from {garage} is on the way to you: arriving around {heure} (about {minutes} min). Follow the trip live: {lien}',
      'en_route_no_eta', 'Hello {prenom}, {mecano} from {garage} is on the way to you. Follow the trip live: {lien}',
      'invoice', 'Hello {prenom}, here is your invoice {numero} from {garage} ({total}): {lien}',
      'extras', 'Hello {prenom}, {mecano} from {garage} suggests extra work on your {vehicule} ({montant} before taxes). To see it and accept or decline: {lien}',
      'reminder', 'Reminder: {garage} comes tomorrow, {jour}, between {debut} and {fin}. To change: {telephone}',
      'payment_reminder', 'Hello {prenom}, a friendly reminder from {garage}: invoice {numero} of {date} ({montant}) is still unpaid. {lien}')
  ) || messages,
  waiver = jsonb_build_object('version', '1',
    'fr', E'J’autorise {garage} à faire les travaux convenus sur mon véhicule, à l’endroit que j’ai indiqué. Je confirme être le propriétaire du véhicule ou avoir son autorisation.\nJe comprends que :\n• les travaux se font sur place (entrée, stationnement ou rue) et je m’assure que l’endroit le permet;\n• le garage n’est pas responsable des objets laissés dans le véhicule, ni des bris causés par l’usure, la rouille ou une pièce déjà défectueuse;\n• si d’autres réparations sont nécessaires, elles ne seront faites qu’avec mon accord;\n• les pièces que je fournis moi-même ne sont pas garanties par le garage.\nLe prix estimé m’a été présenté avant le début des travaux.',
    'en', E'I authorize {garage} to do the agreed work on my vehicle, at the place I indicated. I confirm that I own the vehicle or have the owner’s permission.\nI understand that:\n• the work is done on site (driveway, parking lot or street) and I make sure the place allows it;\n• the garage is not responsible for items left in the vehicle, nor for breakage caused by wear, rust or a part that was already defective;\n• if other repairs are needed, they will only be done with my consent;\n• parts I supply myself are not guaranteed by the garage.\nThe estimated price was shown to me before the work started.'
  ) || waiver,
  appearance = '{"theme": "his", "mode": "auto"}'::jsonb || appearance,
  expense_categories = case when jsonb_array_length(expense_categories) > 0 then expense_categories else
    '["Pièces","Huile et liquides","Carburant","Outils et équipement","Entretien des camions","Assurances","Publicité","Téléphone et internet","Frais bancaires","Repas","Autre"]'::jsonb end
where id = 1;
