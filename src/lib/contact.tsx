import clsx from 'clsx';
import type { PublicConfig } from '../../shared/api.ts';
import { useApi } from './useApi.ts';

/** Abugida Education's one email address. Settings can change it; this is the fallback. */
export const COMPANY_EMAIL = 'info@abugidaeducation.com';

export function useContactEmail(): string {
  const config = useApi<PublicConfig>('/api/auth/config');
  return config.data?.contactEmail || COMPANY_EMAIL;
}

/** The company email as a mailto link, for every "get in touch with the team" message. */
export function ContactEmail({ email, className }: { email?: string; className?: string }) {
  const fallback = useContactEmail();
  const address = email || fallback;
  return (
    <a href={`mailto:${address}`} className={clsx('font-semibold underline underline-offset-2', className)}>
      {address}
    </a>
  );
}
