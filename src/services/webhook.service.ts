import axios from 'axios'
import crypto from 'crypto'
import { WebhookPayload, MerchantWebhook, Merchant } from '../interfaces/webhook.interfaces'
import { validateWebhookUrl } from '../validators/webhook.validators'
import { MerchantAuthService } from './merchant.service';


export class WebhookService {
    private async generateSignature(payload: WebhookPayload, secret: string): Promise<string> {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(JSON.stringify(payload))
        return hmac.digest('hex')
    }

    private async sendWebhookNotification(
        webhookUrl: string,
        payload: WebhookPayload,
        id: string,
    ): Promise<boolean> {
        try {
            const merchant: Merchant | null = await MerchantAuthService.getMerchantById(id)
            // if (!merchant) return
            const signature = await this.generateSignature(payload, merchant?.secret!);
            await axios.post(webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Signature': signature
                },
                timeout: 5000
            });

            return true;
        } catch (err) {
            console.error('Failed to send webhook notification', err)
            return false;
        }
    }

    static async getMerchantWebhook(merchantId: string): Promise<MerchantWebhook | null> {
        // replace with mechanism to find merchant webhook from merchant id.
        // in the future, another argument can be added for the transaction type
        const merchantWebhook: MerchantWebhook = {
            ...sampleWebhookWithoutMerchantId,
            merchantId,
        }
        if (!merchantWebhook.isActive) {
            throw new Error('Merchant web hook not found')
        }
        return merchantWebhook
    }

    private async notifyPaymentUpdate (
        merchantWebhook: MerchantWebhook,
        paymentDetails: Omit<WebhookPayload, 'timestamp'>
    ): Promise<boolean> {
        const merchant = await MerchantAuthService.getMerchantById(merchantWebhook.merchantId)
        if (!merchantWebhook.isActive || !validateWebhookUrl(merchantWebhook.url)) {
            return false;
        }

        const webhookPayload: WebhookPayload = {
            ...paymentDetails,
            timestamp: new Date().toISOString()
        }

        return this.sendWebhookNotification(merchantWebhook.url, webhookPayload, merchant?.secret!)
    }

    async notifyWithRetry(merchantWebhook: MerchantWebhook, webhookPayload: WebhookPayload, maxRetries = 3, delay = 3000) {
        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                await this.notifyPaymentUpdate(merchantWebhook, webhookPayload);
                return; // Exit if successful
            } catch (err) {
                attempts++;
                console.error(`Attempt ${attempts} failed:`, err);

                if (attempts < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
                }
            }
        }
        console.error("Failed to notify after maximum retries.");
    }
}