import type { Deps } from '../deps.js';
import { assessServiceArea, normalisePostcode, type ServiceArea } from '../domain/area.js';

export async function checkServiceArea(deps: Pick<Deps, 'postcodes'>, rawPostcode: string): Promise<ServiceArea> {
  const location = await deps.postcodes.lookup(normalisePostcode(rawPostcode));
  return assessServiceArea(location);
}
