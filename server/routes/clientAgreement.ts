import { Router } from 'express';
import type { Deps } from '../deps.ts';
import { h } from '../http.ts';
import { agreementForToken, emailCurrentLink, signClientAgreement, viewOf } from '../services/clientAgreements.ts';

/**
 * A family's Client Service Agreement, opened from the private link in its email: no sign-in needed.
 * The link's code travels in the request body (POST), never in a URL.
 */
export function clientAgreementRoutes(deps: Deps): Router {
  const router = Router();

  router.post(
    '/view',
    h(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(viewOf(await agreementForToken(deps, req.body?.token)));
    }),
  );

  router.post(
    '/sign',
    h(async (req, res) => {
      const body = req.body || {};
      const signed = await signClientAgreement(deps, body.token, { name: body.name, drawing: body.drawing, agree: body.agree, ip: req.ip, userAgent: req.get('user-agent') });
      res.setHeader('Cache-Control', 'no-store');
      res.json(viewOf(signed));
    }),
  );

  // From an out-of-date link: email the current link to the address on the agreement.
  router.post(
    '/email-link',
    h(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await emailCurrentLink(deps, req.body?.token, req.ip || ''));
    }),
  );

  return router;
}
