import { http } from '@google-cloud/functions-framework';

import { paymentWebhook } from './webhook.js';


// Public HTTP endpoint for Razorpay. Authenticated by the webhook signature, not by IAM.
http('paymentWebhook', paymentWebhook);
