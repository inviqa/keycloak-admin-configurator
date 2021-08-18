import filter from "lodash/filter";
import defaults from "lodash/defaults";
import deepmerge from "deepmerge";
import { inspect } from "util";
import KeycloakAdminClient from "keycloak-admin";
import ProtocolMapperRepresentation from "keycloak-admin/lib/defs/protocolMapperRepresentation";
import ClientScopeRepresentation from "keycloak-admin/lib/defs/clientScopeRepresentation";
import RealmRepresentation from "keycloak-admin/lib/defs/realmRepresentation";
import ClientRepresentation from "keycloak-admin/lib/defs/clientRepresentation";
import RoleRepresentation from "keycloak-admin/lib/defs/roleRepresentation";

const overwriteMerge = (destinationArray, sourceArray) => sourceArray;

type RoleMappings = string[];
type ClientRoleMappings = { [key: string]: RoleMappings };

type AllRoleMappings = {
  realm: RoleMappings;
  clients: ClientRoleMappings;
};

async function insertOrUpdate(
  resource,
  primaryField,
  match,
  pathData,
  resourceData
) {
  const matchedItems = filter(await resource.find(pathData), match);
  if (matchedItems.length > 0) {
    const identifier = { [primaryField]: matchedItems[0][primaryField] };
    const updatePathData = deepmerge(pathData, identifier);
    const updatedItem = deepmerge(matchedItems[0], resourceData, {
      arrayMerge: overwriteMerge,
    });
    await resource.update(updatePathData, updatedItem);
    return identifier;
  }

  const insertedItem = await resource.create(
    deepmerge(pathData, resourceData, { arrayMerge: overwriteMerge })
  );

  // some resources return the response
  if (insertedItem) {
    return insertedItem;
  }

  // some resources return a 201, so find the item after it's created
  return findResourceItem(resource, match, pathData);
}

async function findResourceItem(resource, match, pathData) {
  const matchedInsertedItems = filter(await resource.find(pathData), match);
  if (matchedInsertedItems.length > 0) {
    return matchedInsertedItems[0];
  }

  throw `Resource item didn't find a match for ${inspect(match)}`;
}

function arrayChanges(oldArray, newArray) {
  return {
    additions: newArray.filter((x) => !oldArray.some((y) => x.id === y.id)),
    deletions: oldArray.filter((x) => !newArray.some((y) => x.id === y.id)),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default function dsl(adminClient: KeycloakAdminClient) {
  async function getClient(realm: string, clientId: string) {
    const client = (await adminClient.clients.find({ realm, clientId })).pop();
    if (!client || !client.id) {
      throw new Error(`No client in ${realm} with clientId ${clientId}`);
    }
    return client;
  }

  async function realm(realmData: RealmRepresentation) {
    return insertOrUpdate(
      adminClient.realms,
      "realm",
      { realm: realmData.realm },
      {},
      realmData
    );
  }

  async function client({
    realm,
    ...clientData
  }: { realm: string } & ClientRepresentation) {
    return insertOrUpdate(
      adminClient.clients,
      "id",
      { clientId: clientData.clientId },
      { realm },
      clientData
    );
  }

  async function clientScopeProtocolMapper({
    realm,
    clientScopeId,
    ...protocolMapperData
  }: {
    realm: string;
    clientScopeId: string;
  } & ProtocolMapperRepresentation) {
    // insertOrUpdate needs a resource, so make a proxy object for clientScopes protocolMapper functions
    const protocolMapperResource = {
      find: ({ realm, clientScopeId }) =>
        adminClient.clientScopes.listProtocolMappers({
          realm,
          id: clientScopeId,
        }),
      create: ({ realm, clientScopeId, ...data }) =>
        adminClient.clientScopes.addProtocolMapper(
          { realm, id: clientScopeId },
          data
        ),
      update: ({ realm, clientScopeId, id: mapperId }, data) =>
        adminClient.clientScopes.updateProtocolMapper(
          { realm, id: clientScopeId, mapperId },
          data
        ),
    };

    return insertOrUpdate(
      protocolMapperResource,
      "id",
      { name: protocolMapperData.name },
      { realm, clientScopeId },
      protocolMapperData
    );
  }

  async function clientScope({
    realm,
    protocolMappers = [],
    ...clientScopeData
  }: {
    realm: string;
    protocolMappers: ProtocolMapperRepresentation[];
  } & ClientScopeRepresentation) {
    const { id } = await insertOrUpdate(
      adminClient.clientScopes,
      "id",
      { name: clientScopeData.name },
      { realm },
      clientScopeData
    );

    await Promise.all(
      protocolMappers.map((protocolMapperData) =>
        clientScopeProtocolMapper({
          realm,
          clientScopeId: id,
          ...protocolMapperData,
        })
      )
    );

    return { id };
  }

  async function clientRoles(
    realm: string,
    clientId: string,
    rolesData: RoleRepresentation[]
  ) {
    const client = await getClient(realm, clientId);
    const clientRoleResource = {
      find: ({ realm, clientid }) =>
        adminClient.clients.listRoles({
          realm,
          id: clientid,
        }),
      create: ({ realm, clientid, ...data }) =>
        adminClient.clients.createRole({ realm, id: clientid, ...data }),
      update: ({ realm, clientid, name: roleName }, data) =>
        adminClient.clients.updateRole({ realm, id: clientid, roleName }, data),
    };

    for (const { composites, ...roleData } of rolesData) {
      if (!roleData.name) {
        continue;
      }
      await insertOrUpdate(
        clientRoleResource,
        "name",
        { name: roleData.name },
        { realm, clientid: client.id },
        roleData
      );

      await clientRoleComposites(
        realm,
        client.id as string,
        roleData.name,
        composites
      );
    }
  }

  async function clientRoleComposites(
    realm: string,
    clientid: string,
    roleName: string,
    composites: RoleRepresentation["composites"]
  ) {
    const query = { realm, id: clientid, roleName };

    const oldComposites = adminClient.clients.listRoleComposites(query);
    const newComposites = Promise.all([
      ...Object.entries(composites?.client || {}).flatMap(
        ([clientId, roles]: [string, string[]]) => {
          const client = getClient(realm, clientId);
          return roles.map(async (roleName) =>
            adminClient.clients.findRole({
              realm,
              id: (await client).id as string,
              roleName,
            })
          );
        }
      ),
      ...(composites?.realm?.map((name) =>
        adminClient.roles.findOneByName({ realm, name })
      ) || []),
    ]);

    const { additions, deletions } = arrayChanges(
      await oldComposites,
      await newComposites
    );

    await Promise.all([
      adminClient.clients.createRoleComposites(query, additions),
      adminClient.clients.delRoleComposites(query, deletions),
    ]);
  }

  async function userRealmRoleMappings({
    realm,
    id,
    roles,
  }: {
    realm: string;
    id: string;
    roles: RoleMappings;
  }) {
    const roleMappings = await adminClient.users.listRealmRoleMappings({
      realm,
      id,
    });
    const existingRoles = roleMappings.map(({ id, name }) => ({ id, name }));
    const newRoles = (
      await Promise.all(
        roles.map((roleName) =>
          adminClient.roles.findOneByName({ realm, name: roleName })
        )
      )
    ).map(({ id, name }) => ({ id, name }));

    const { additions, deletions } = arrayChanges(existingRoles, newRoles);

    await Promise.all([
      additions.length > 0
        ? adminClient.users.addRealmRoleMappings({
            realm,
            id,
            roles: additions,
          })
        : null,
      deletions.length > 0
        ? adminClient.users.delRealmRoleMappings({
            realm,
            id,
            roles: deletions,
          })
        : null,
    ]);
  }

  async function userClientRoleMappings({
    realm,
    id,
    clientId,
    roles,
  }: {
    realm: string;
    id: string;
    clientId: string;
    roles: RoleMappings;
  }) {
    const { id: clientUniqueId } = (
      await adminClient.clients.find({
        realm,
        clientId,
      })
    )[0];

    if (!clientUniqueId) {
      return;
    }

    const roleMappings = await adminClient.users.listClientRoleMappings({
      realm,
      id,
      clientUniqueId,
    });
    const existingRoles = roleMappings.map(({ id, name }) => ({ id, name }));
    const newRoles = (
      await Promise.all(
        roles.map((roleName) =>
          adminClient.clients.findRole({ realm, id: clientUniqueId, roleName })
        )
      )
    ).map(({ id, name }) => ({ id, name }));

    const { additions, deletions } = arrayChanges(existingRoles, newRoles);

    await Promise.all([
      additions.length > 0
        ? adminClient.users.addClientRoleMappings({
            realm,
            id,
            clientUniqueId,
            roles: additions,
          })
        : null,
      deletions.length > 0
        ? adminClient.users.delClientRoleMappings({
            realm,
            id,
            clientUniqueId,
            roles: deletions,
          })
        : null,
    ]);
  }

  async function userRoleMappings({
    realm,
    id,
    roleMappings: { realm: realmRoles = [], clients: clientRoles = {} },
  }: {
    realm: string;
    id: string;
    roleMappings: AllRoleMappings;
  }) {
    await Promise.all([
      userRealmRoleMappings({ realm, id, roles: realmRoles }),
      ...Object.entries(
        clientRoles
      ).map(([clientId, roles]: [string, string[]]) =>
        userClientRoleMappings({ realm, id, clientId, roles })
      ),
    ]);
  }

  async function serviceAccount({
    realm,
    roleMappings,
    ...serviceAccountData
  }: {
    realm: string;
    roleMappings: {
      realm: string[];
      clients: {
        [key: string]: string[];
      };
    };
  }) {
    const mergedServiceAccountData = defaults(serviceAccountData, {
      clientAuthenticatorType: "client-secret",
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      publicClient: false,
      protocol: "openid-connect",
      defaultClientScopes: ["role_list", "roles"],
    });

    const { id } = await client({ realm, ...mergedServiceAccountData });
    const serviceAccountUser = await adminClient.clients.getServiceAccountUser({
      realm,
      id,
    });

    if (roleMappings && serviceAccountUser.id) {
      await userRoleMappings({
        realm,
        id: serviceAccountUser.id,
        roleMappings,
      });
    }
  }

  return { realm, client, clientRoles, clientScope, serviceAccount };
}
