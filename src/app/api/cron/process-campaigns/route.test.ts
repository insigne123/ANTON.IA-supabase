import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const routeSource = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const initialSendSource = await readFile(new URL('../antonia/route.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const helperNode = sourceFile.statements.find((statement) => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'doesLeadBelongToCampaignAudience'
));

if (!helperNode) throw new Error('doesLeadBelongToCampaignAudience was not found in route.ts');

const transpiledHelper = ts.transpileModule(
    `${helperNode.getText(sourceFile)}\nexport { doesLeadBelongToCampaignAudience };`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(transpiledHelper).toString('base64')}`);
const doesLeadBelongToCampaignAudience = helperModule.doesLeadBelongToCampaignAudience as (input: any) => boolean;

test('ordinary campaigns only include contacts with matching campaign lineage', () => {
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead: { campaign_id: 'campaign-a' },
    }), true);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead: { data: { campaign_id: 'campaign-a' } },
    }), true);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        lead: { data: { campaignId: 'campaign-a' } },
    }), true);
});

test('ordinary campaigns fail closed without matching lineage', () => {
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead: {},
    }), false);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead: { campaign_id: 'campaign-b' },
    }), false);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead: { campaign_id: 'campaign-a', data: { campaignId: 'campaign-b' } },
    }), false);
});

test('two ordinary campaigns cannot include the same unrelated contact', () => {
    const lead = { data: { campaign_id: 'campaign-a' } };

    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-a',
        campaignType: 'follow_up',
        lead,
    }), true);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-b',
        campaignType: 'follow_up',
        lead,
    }), false);
});

test('organization history requires an explicit reactivation campaign and audience', () => {
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-reactivation',
        campaignType: 'reconnection',
        audienceKind: 'reactivation',
        lead: {},
    }), true);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-reactivation',
        campaignType: 'reconnection',
        lead: {},
    }), false);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-reactivation',
        audienceKind: 'reactivation',
        lead: {},
    }), false);
    assert.equal(doesLeadBelongToCampaignAudience({
        campaignId: 'campaign-reactivation',
        campaignType: 'follow_up',
        audienceKind: 'reactivation',
        lead: {},
    }), false);
});

test('campaign processing applies the audience guard before eligibility work', () => {
    assert.match(routeSource, /if \(!doesLeadBelongToCampaignAudience\([\s\S]*?\)\) continue;[\s\S]*?\/\/ Skip if excluded or replied/);
});

test('scoped runs validate and apply the organization filter', () => {
    assert.match(routeSource, /organizationId must be a UUID when provided/);
    assert.match(routeSource, /campaignsQuery = campaignsQuery\.eq\('organization_id', organizationIdFilter\)/);
});

test('dry runs skip reply synchronization and campaign writes', () => {
    assert.match(routeSource, /if \(!dryRun\) \{[\s\S]*?syncRepliesForOrganization/);
    assert.match(routeSource, /if \(!dryRun\) \{[\s\S]*?\.from\('campaigns'\)[\s\S]*?\.update/);
});

test('generated initial campaign sends persist durable campaign lineage', () => {
    assert.match(initialSendSource, /campaign_id: campaign\.id,[\s\S]*?data: \{\s*campaign_id: campaign\.id,/);
});
