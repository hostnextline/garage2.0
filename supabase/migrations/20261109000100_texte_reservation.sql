-- Part 24 sexies: the booking text is the estimate, not a bill.
--   messages.{fr,en}.booking   each service on its own line with its price ({services}), then « Total : {soustotal} » = « 159,98 $ + tx » (before
--                              taxes), then the link to accept the estimate and authorize the work with one button. No « pay now »
--                              before the work ({payer} is no longer used by this text).
update public.settings set messages = jsonb_set(jsonb_set(coalesce(messages, '{}'::jsonb),
  '{fr,booking}', to_jsonb(E'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, {bloc} (entre {debut} et {fin}).\n\nEstimation :\n{services}\nTotal : {soustotal}\n\nPour accepter l’estimation et autoriser les travaux sur votre véhicule (un seul bouton) : {lien}'::text), true),
  '{en,booking}', to_jsonb(E'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, {bloc} (between {debut} and {fin}).\n\nEstimate:\n{services}\nTotal: {soustotal}\n\nTo accept the estimate and authorize the work on your vehicle (one button): {lien}'::text), true)
where id = 1;
