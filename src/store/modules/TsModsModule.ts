import { ActionTree, GetterTree, MutationTree } from 'vuex';

import { State as RootState } from '../index';
import ManifestV2 from '../../model/ManifestV2';
import ThunderstoreMod from '../../model/ThunderstoreMod';
import VersionNumber from '../../model/VersionNumber';
import CdnProvider from '../../providers/generic/connection/CdnProvider';
import ConnectionProvider from '../../providers/generic/connection/ConnectionProvider';
import * as PackageDb from '../../r2mm/manager/PackageDexieStore';
import { isEmptyArray, isStringArray } from '../../utils/ArrayUtils';
import { retry } from '../../utils/Common';
import { Deprecations } from '../../utils/Deprecations';
import { fetchAndProcessBlobFile } from '../../utils/HttpUtils';

export interface CachedMod {
    tsMod: ThunderstoreMod | undefined;
    isLatest: boolean;
}

interface State {
    cache: Map<string, CachedMod>;
    deprecated: Map<string, boolean>;
    exclusions?: string[];
    isThunderstoreModListUpdateInProgress: boolean;
    mods: ThunderstoreMod[];
    modsLastUpdated?: Date;
    thunderstoreModListUpdateError: string;
}

type ProgressCallback = (progress: number) => void;
type PackageListChunk = {full_name: string}[];
export type PackageListChunks = PackageListChunk[];
export type PackageListIndex = {content: string[], hash: string, isLatest: boolean};

function isPackageListChunk(value: unknown): value is PackageListChunk {
    return Array.isArray(value) && (
        !value.length || typeof value[0].full_name === "string"
    );
}

/**
 * For dealing with mods listed in communities, i.e. available through
 * the Thunderstore API. Mods received from the API are stored in
 * IndexedDB (via Dexie). For performance they're also stored in memory
 * by this Vuex store module.
 */
export const TsModsModule = {
    namespaced: true,

    state: (): State => ({
        cache: new Map<string, CachedMod>(),
        deprecated: new Map<string, boolean>(),
        /*** Packages available through API that should be ignored by the manager */
        exclusions: undefined,
        /*** Mod list is updated from the API automatically and by user action */
        isThunderstoreModListUpdateInProgress: false,
        /*** All mods available through API for the current active game */
        mods: [],
        /*** When was the mod list last refreshed from the API? */
        modsLastUpdated: undefined,
        /*** Error shown on UI after manual mod list refresh fails */
        thunderstoreModListUpdateError: ''
    }),

    getters: <GetterTree<State, RootState>>{
        /** Vue components mostly process mods in ManifestV2 format,
         *  but sometimes need access to ThunderstoreMod format and
         *  related data too. Since filtering the whole mods list every
         *  time this happens slows down the LocalModList, cache the
         *  data in a Map.
         */
        cachedMod: (state) => (mod: ManifestV2): CachedMod => {
            const cacheKey = `${mod.getName()}-${mod.getVersionNumber()}`;

            if (state.cache.get(cacheKey) === undefined) {
                const tsMod = state.mods.find((m) => m.getFullName() === mod.getName());

                // Updating Vuex state directly instead of mutations is a bad
                // practice but everything seems to work here since we only
                // mutate the map instead of replacing it altogether.
                if (tsMod === undefined) {
                    state.cache.set(cacheKey, {tsMod: undefined, isLatest: true});
                } else {
                    const latestVersionNumber = new VersionNumber(tsMod.getLatestVersion());
                    const isLatest = mod.getVersionNumber().isEqualOrNewerThan(latestVersionNumber);
                    state.cache.set(cacheKey, {tsMod, isLatest});
                }
            }

            return state.cache.get(cacheKey) as CachedMod;
        },

        /*** Categories used by any mod listed in the community */
        categories(state) {
            const categories = Array.from(
                new Set(
                    state.mods.map((mod) => mod.getCategories()).flat()
                )
            );
            categories.sort();
            return categories;
        },

        /*** Is the version of a mod defined by ManifestV2 the newest version? */
        isLatestVersion: (_state, getters) => (mod: ManifestV2): boolean => {
            return getters.cachedMod(mod).isLatest;
        },

        /*** Return ThunderstoreMod representation of a ManifestV2 */
        tsMod: (_state, getters) => (mod: ManifestV2): ThunderstoreMod | undefined => {
            return getters.cachedMod(mod).tsMod;
        },

        undeprecatedModCount(state) {
            return [...state.deprecated].filter(([_, isDeprecated]) => !isDeprecated).length;
        }
    },

    mutations: <MutationTree<State>>{
        reset(state: State) {
            state.cache = new Map<string, CachedMod>();
            state.deprecated = new Map<string, boolean>();
            state.exclusions = undefined;
            state.mods = [];
            state.modsLastUpdated = undefined;
            state.thunderstoreModListUpdateError = '';
        },
        clearModCache(state) {
            state.cache.clear();
        },
        finishThunderstoreModListUpdate(state) {
            state.isThunderstoreModListUpdateInProgress = false;
        },
        setMods(state, payload: ThunderstoreMod[]) {
            state.mods = payload;
        },
        setModsLastUpdated(state, payload: Date|undefined) {
            state.modsLastUpdated = payload;
        },
        setExclusions(state, payload: string[]) {
            state.exclusions = payload;
        },
        setThunderstoreModListUpdateError(state, error: string|unknown) {
            if (typeof error === 'string') {
                state.thunderstoreModListUpdateError = error;
            } else {
                const msg = error instanceof Error ? error.message : "Unknown error";
                state.thunderstoreModListUpdateError = msg;
            }
        },
        startThunderstoreModListUpdate(state) {
            state.isThunderstoreModListUpdateInProgress = true;
        },
        updateDeprecated(state, allMods: ThunderstoreMod[]) {
            state.deprecated = Deprecations.getDeprecatedPackageMap(allMods);
        }
    },

    actions: <ActionTree<State, RootState>>{
        async fetchAndProcessPackageList({dispatch, state}) {
            const packageListIndex: PackageListIndex = await dispatch('fetchPackageListIndex');

            // If the package list is up to date, only update the timestamp. Otherwise,
            // fetch the new one and store it into IndexedDB.
            if (packageListIndex.isLatest) {
                await dispatch('updateIndexHash', packageListIndex.hash);
            } else {
                const packageListChunks = await dispatch(
                    'fetchPackageListChunks',
                    {chunkUrls: packageListIndex.content},
                );
                await dispatch(
                    'updatePersistentCache',
                    {chunks: packageListChunks, indexHash: packageListIndex.hash},
                );
            }

            // If the package list was up to date and the mod list is already loaded to
            // Vuex, just update the timestamp. Otherwise, load the list from IndexedDB
            // to Vuex. This needs to be done even if the index hasn't updated when the
            // mod list in Vuex is empty, as this indicates an error state and otherwise
            // the user would be stuck with empty list until a new index hash is
            // available via the API.
            if (packageListIndex.isLatest && state.mods.length > 0) {
                await dispatch('updateModsLastUpdated');
            } else {
                await dispatch('updateMods');
                await dispatch('profile/tryLoadModListFromDisk', null, {root: true});
                await dispatch('prewarmCache');
            }
        },

        async fetchPackageListIndex({rootState}): Promise<PackageListIndex> {
            const indexUrl = CdnProvider.addCdnQueryParameter(rootState.activeGame.thunderstoreUrl);
            const index = await retry(() => fetchAndProcessBlobFile(indexUrl), 5, 2000);

            if (!isStringArray(index.content)) {
                throw new Error('Received invalid chunk index from API');
            }
            if (isEmptyArray(index.content)) {
                throw new Error('Received empty chunk index from API');
            }

            const community = rootState.activeGame.internalFolderName;
            const isLatest = await PackageDb.isLatestPackageListIndex(community, index.hash);
            return {...index, isLatest};
        },

        async fetchPackageListChunks(
            {},
            {chunkUrls, progressCallback}: {chunkUrls: string[], progressCallback?: ProgressCallback},
        ): Promise<PackageListChunks> {
            // Count index as a chunk for progress bar purposes.
            const chunkCount = chunkUrls.length + 1;
            let completed = 1;
            const updateProgress = () => progressCallback && progressCallback((completed / chunkCount) * 100);
            updateProgress();

            // Download chunks serially to avoid slow connections timing
            // out due to concurrent requests competing for the bandwidth.
            const chunks = [];
            for (const [i, chunkUrl] of chunkUrls.entries()) {
                const url = CdnProvider.replaceCdnHost(chunkUrl);
                const {content: chunk} = await retry(() => fetchAndProcessBlobFile(url));

                if (chunkUrls.length > 1 && isEmptyArray(chunk)) {
                    throw new Error(`Chunk #${i} in multichunk response was empty`);
                } else if (!isPackageListChunk(chunk)) {
                    throw new Error(`Chunk #${i} was invalid format`);
                }

                chunks.push(chunk);
                completed++;
                updateProgress();
            }

            return chunks;
        },

        async gameHasCachedModList({rootState}): Promise<boolean> {
            const updated = await PackageDb.getLastPackageListUpdateTime(rootState.activeGame.internalFolderName);
            return updated !== undefined;
        },

        async prewarmCache({getters, rootGetters}) {
            const profileMods: ManifestV2[] = rootGetters['profile/modList'];
            profileMods.forEach(getters['cachedMod']);
        },

        async updateExclusions(
            {commit},
            progressCallback?: ProgressCallback
        ) {
            const exclusions = await ConnectionProvider.instance.getExclusions(progressCallback);
            commit('setExclusions', exclusions);
        },

        async updateMods({commit, dispatch, rootState}) {
            const modList = await PackageDb.getPackagesAsThunderstoreMods(rootState.activeGame.internalFolderName);
            commit('setMods', modList);
            commit('updateDeprecated', modList);
            commit('clearModCache');
            await dispatch('updateModsLastUpdated');
        },

        async updateModsLastUpdated({commit, rootState}) {
            const updated = await PackageDb.getLastPackageListUpdateTime(rootState.activeGame.internalFolderName);
            commit('setModsLastUpdated', updated);
        },

        /*** Save a mod list received from the Thunderstore API to IndexedDB */
        async updatePersistentCache(
            {dispatch, rootState, state},
            {chunks, indexHash}: {chunks: PackageListChunks, indexHash: string}
        ) {
            // Splash screen skipped this if there was no need to update the
            // package list. It may be needed later by e.g. the background update.
            if (state.exclusions === undefined) {
                await dispatch('updateExclusions');
            }

            const filtered = chunks.map((chunk) => chunk.filter(
                (pkg) => !state.exclusions!.includes(pkg.full_name)
            ));
            const community = rootState.activeGame.internalFolderName;
            await PackageDb.updateFromApiResponse(community, filtered);
            await dispatch('updateIndexHash', indexHash);
        },

        async updateIndexHash({rootState}, indexHash: string) {
            const community = rootState.activeGame.internalFolderName;
            await PackageDb.setLatestPackageListIndex(community, indexHash);
        },
    }
}
