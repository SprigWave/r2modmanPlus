<script lang="ts">
import { Vue, Component, Prop } from 'vue-property-decorator';
import { ExpandableCard, Link } from '../../all';
import DonateButton from '../../buttons/DonateButton.vue';
import ManifestV2 from '../../../model/ManifestV2';
import ModBridge from '../../../r2mm/mods/ModBridge';

@Component({
    components: {
        DonateButton,
        ExpandableCard,
        Link,
    }
})
export default class LocalModCard extends Vue {

    @Prop({required: true})
    readonly mod!: ManifestV2;

    @Prop({required: true})
    readonly disabledDependencies!: ManifestV2[];

    @Prop({required: true})
    readonly missingDependencies!: string[];

    @Prop({required: true})
    readonly expandedByDefault!: boolean;

    @Prop({required: true})
    readonly showSort!: boolean;

    @Prop({required: true})
    readonly funkyMode!: boolean;

    get donationLink() {
        return this.tsMod ? this.tsMod.getDonationLink() : undefined;
    }

    get isLatestVersion() {
        return ModBridge.isCachedLatestVersion(this.mod);
    }

    get tsMod() {
        return ModBridge.getCachedThunderstoreModFromMod(this.mod);
    }

    disableMod() {
        this.$emit('disableMod', this.mod);
    }

    enableMod(mod: ManifestV2) {
        this.$emit('enableMod', mod);
    }

    uninstallMod() {
        this.$emit('uninstallMod', this.mod);
    }

    updateMod() {
        this.$emit('updateMod', this.mod);
    }

    downloadDependency(dependency: string) {
        this.$emit('downloadDependency', dependency);
    }

    viewDependencyList() {
        this.$emit('viewDependencyList', this.mod);
    }
}
</script>

<template>
    <expandable-card
        :description="mod.getDescription()"
        :enabled="mod.isEnabled()"
        :expandedByDefault="expandedByDefault"
        :funkyMode="funkyMode"
        :id="`${mod.getAuthorName()}-${mod.getName()}-${mod.getVersionNumber()}`"
        :image="mod.getIcon()"
        :showSort="showSort">

        <template v-slot:title>
            <span class="non-selectable">
                <span v-if="mod.isDeprecated()"
                    class="tag is-danger margin-right margin-right--half-width"
                    v-tooltip.right="'This mod is deprecated and could be broken'">
                    Deprecated
                </span>
                <span v-if="!mod.isEnabled()"
                    class="tag is-warning margin-right margin-right--half-width"
                    v-tooltip.right="'This mod will not be used in-game'">
                    Disabled
                </span>
                <span class="card-title selectable">
                    <component :is="mod.isEnabled() ? 'span' : 'strike'" class="selectable">
                        {{mod.getDisplayName()}}
                        <span class="selectable card-byline">
                            v{{mod.getVersionNumber()}}
                        </span>
                        <span :class="`card-byline ${mod.isEnabled() && 'selectable'}`">
                            by {{mod.getAuthorName()}}
                        </span>
                    </component>
                </span>
            </span>
        </template>

        <template v-slot:other-icons>
            <!-- Show update and missing dependency icons -->
            <span v-if="donationLink" class='card-header-icon'>
                <Link :url="donationLink" target="external" tag="span">
                    <i class='fas fa-heart' v-tooltip.left="'Donate to the mod author'"></i>
                </Link>
            </span>
            <span v-if="!isLatestVersion"
                @click.prevent.stop="updateMod()"
                class='card-header-icon'>
                <i class='fas fa-cloud-upload-alt' v-tooltip.left="'An update is available'"></i>
            </span>
            <span v-if="disabledDependencies.length || missingDependencies.length"
                class='card-header-icon'>
                <i v-tooltip.left="`There is an issue with the dependencies for this mod`"
                    class='fas fa-exclamation-circle'
                ></i>
            </span>
            <span @click.prevent.stop="() => mod.isEnabled() ? disableMod() : enableMod(mod)"
                class='card-header-icon'>
                <div class="field">
                    <input id="switchExample"
                        type="checkbox"
                        name="switchExample"
                        :class='`switch is-small  ${mod.isEnabled() ? "switch is-info" : ""}`'
                        :checked="mod.isEnabled()" />
                    <label for="switchExample" v-tooltip.left="mod.isEnabled() ? 'Disable' : 'Enable'"></label>
                </div>
            </span>
        </template>

        <!-- Show bottom button row -->
        <a @click="uninstallMod()" class='card-footer-item'>
            Uninstall
        </a>

        <a v-if="mod.isEnabled()" @click="disableMod()" class='card-footer-item'>
            Disable
        </a>
        <a v-else @click="enableMod(mod)" class='card-footer-item' >
            Enable
        </a>

        <a @click="viewDependencyList()" class='card-footer-item'>
            Associated
        </a>

        <Link :url="mod.getWebsiteUrl()" :target="'external'" class="card-footer-item">
            Website
            <i class="fas fa-external-link-alt margin-left margin-left--half-width"></i>
        </Link>

        <a v-if="!isLatestVersion" @click="updateMod()" class='card-footer-item'>
            Update
        </a>

        <a v-if="missingDependencies.length"
            @click="downloadDependency(missingDependencies[0])"
            class='card-footer-item'>
            Download dependency
        </a>

        <a v-if="disabledDependencies.length"
            @click="enableMod(disabledDependencies[0])"
            class='card-footer-item'>
            Enable {{disabledDependencies[0].getDisplayName()}}
        </a>

        <DonateButton v-if="donationLink" :mod="tsMod"/>
    </expandable-card>
</template>

<style scoped lang="scss">

</style>