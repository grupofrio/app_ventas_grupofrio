import assert from 'node:assert/strict';

interface PostvisitPayloadModule {
  buildPostvisitPayload: (input: {
    stop: {
      id: number;
      customer_name: string;
      _entityType?: 'customer' | 'lead';
      _leadId?: number | null;
      _partnerId?: number | null;
      partner_id?: [number, string] | number | false | null;
    };
    form: {
      contactName: string;
      phone: string;
      email: string;
      competitor: string;
      freezer: 'yes' | 'no';
      interestLevel: 'high' | 'medium' | 'low';
      notes: string;
    };
    stageId: number;
  }) => Record<string, unknown>;
}

function testExistingLeadBuildsUpsertPayload(module: PostvisitPayloadModule) {
  const payload = module.buildPostvisitPayload({
    stop: {
      id: 4333,
      customer_name: 'Lead Plaza',
      _entityType: 'lead',
      _leadId: 51,
      partner_id: [777, 'Cliente Demo'],
    },
    form: {
      contactName: 'Ana',
      phone: '555-111',
      email: 'ana@example.com',
      competitor: 'Crystal',
      freezer: 'yes',
      interestLevel: 'high',
      notes: 'Quiere demo esta semana',
    },
    stageId: 15,
  });

  assert.equal(payload.stop_id, 4333);
  assert.equal(payload.lead_id, 51);
  assert.equal(payload.partner_id, 777);
  assert.equal('company_id' in payload, false);
  assert.equal(payload.stage_id, 15);
  assert.equal(payload.contact_name, 'Ana');
  assert.equal(payload.priority, '3');
  assert.equal(payload.interest_level, 'high');
  assert.match(String(payload.description), /Competidor: Crystal/);
}

function testCustomerBuildsNewLeadPayload(module: PostvisitPayloadModule) {
  const payload = module.buildPostvisitPayload({
    stop: {
      id: 9876,
      customer_name: 'Abarrotes Centro',
      _entityType: 'customer',
      _leadId: null,
    },
    form: {
      contactName: '',
      phone: '',
      email: '',
      competitor: '',
      freezer: 'no',
      interestLevel: 'medium',
      notes: 'Sin decision hoy',
    },
    stageId: 12,
  });

  assert.equal(payload.stop_id, 9876);
  assert.equal(payload.lead_id, null);
  assert.equal(payload.partner_id, null);
  assert.equal(payload.customer_name, 'Abarrotes Centro');
  assert.equal(payload.stage_id, 12);
  assert.equal('company_id' in payload, false);
  assert.equal(payload.priority, '2');
}

async function main() {
  const module = await import(
    new URL('../src/services/postvisitPayload.ts', import.meta.url).pathname
  ) as PostvisitPayloadModule;

  testExistingLeadBuildsUpsertPayload(module);
  testCustomerBuildsNewLeadPayload(module);
  console.log('postvisit payload tests: ok');
}

void main();
