const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function simulateCheckoutSessionCompleted() {
  try {
    const userId = '9mBfvniXTuMtQU8f0OnLhUK6aOv2';
    
    // Simulate checkout session data
    const sessionData = {
      id: 'cs_test_' + Date.now(),
      customer: 'cus_test_' + Date.now(),
      subscription: 'sub_test_' + Date.now(),
      metadata: {
        planId: 'enterprise',
        billingCycle: 'monthly'
      },
      customer_email: 'jack.33.wong@gmail.com'
    };
    
    console.log('Simulating checkout session completion:', sessionData.id);
    
    // Extract subscription data from session metadata
    const planId = sessionData.metadata.planId;
    const billingCycle = sessionData.metadata.billingCycle;
    const customerId = sessionData.customer;
    const subscriptionId = sessionData.subscription;
    
    if (!planId || !billingCycle || !customerId || !subscriptionId) {
      console.error('Missing required data in checkout session');
      return;
    }
    
    // Simulate subscription data (normally would come from Stripe)
    const subscriptionData = {
      items: {
        data: [{
          price: {
            unit_amount: 10000 // $100.00 for Enterprise
          }
        }]
      },
      currency: 'usd',
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    };
    
    // Cancel all existing active subscriptions first
    const subscriptions = await db.collection('userSubscriptions')
      .where('userId', '==', userId)
      .get();
    
    const activeSubscriptions = subscriptions.docs.filter(doc => doc.data().status === 'active');
    console.log('Found', activeSubscriptions.length, 'active subscriptions to cancel');
    
    for (const doc of activeSubscriptions) {
      await doc.ref.update({
        status: 'canceled',
        updatedAt: Date.now()
      });
      console.log('Canceled subscription:', doc.id);
    }
    
    // Create new subscription
    const newSubscriptionData = {
      userId: userId,
      email: sessionData.customer_email,
      planId: planId,
      billingCycle: billingCycle,
      amount: subscriptionData.items.data[0].price.unit_amount,
      currency: subscriptionData.currency,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      status: subscriptionData.status,
      currentPeriodStart: subscriptionData.current_period_start,
      currentPeriodEnd: subscriptionData.current_period_end,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    const docRef = await db.collection('userSubscriptions').add(newSubscriptionData);
    console.log('Created new subscription with ID:', docRef.id);
    console.log('New subscription data:', JSON.stringify(newSubscriptionData, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

simulateCheckoutSessionCompleted();
