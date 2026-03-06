export const config = { runtime: 'nodejs' };

import { createDomainGateway } from '../../server/gateway';
import { createIntelEngineRoutes } from '../../server/intel_engine/routes';

export default createDomainGateway(createIntelEngineRoutes());
