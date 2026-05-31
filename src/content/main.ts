import { logger } from '../services/logger.ts';
import { DocController } from './doc-controller.ts';

(() => {
  const controller = new DocController();
  if (!controller.isActive()) {
    return;
  }
  logger.info({ url: window.location.href }, 'ProofOS content script initialized');
  void controller.init();
})();
