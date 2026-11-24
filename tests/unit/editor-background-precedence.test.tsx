/**
 * S16: the LATEST background choice wins. The renderer paints image > solid
 * colour > preset mesh, so choosing a preset has to drop an uploaded image AND
 * a solid colour, otherwise the click has no visible effect.
 *
 * These tests drive the real editor UI (EditorStudio + VibePresetsPanel).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VibePresetsPanel } from '../../src/editor/VibePresetsPanel';
import { VIBE_PRESETS } from '../../src/engine/renderer';

const hasReset = () => screen.queryByTitle('Reset custom background to preset backdrop') !== null;

// A backdrop name appears twice: as a card in the preset grid and as a button in the backdrop matrix.
const matrixButton = (name: string) => screen.getAllByText(name).find((n) => n.className.includes('p-1.5'))!;
const gridCard = (name: string) => screen.getAllByText(name).find((n) => !n.className.includes('p-1.5'))!;

describe('EditorStudio: preset choice replaces a solid colour', () => {
  it('picking a swatch then a preset removes the swatch (Reset disappears)', async () => {
    const { EditorStudio } = await import('../../src/editor/EditorStudio');
    render(React.createElement(EditorStudio));
    expect(hasReset()).toBe(false);

    fireEvent.click(screen.getByTitle('#064E3B'));
    expect(hasReset(), 'a solid colour is now the background').toBe(true);

    // A preset from the preset grid.
    fireEvent.click(gridCard('Linear Cosmic'));
    expect(hasReset(), 'the preset choice must drop the solid colour').toBe(false);
    cleanup();
  });

  it('re-clicking the backdrop type that is ALREADY active also drops the colour', async () => {
    const { EditorStudio } = await import('../../src/editor/EditorStudio');
    render(React.createElement(EditorStudio));
    // Keynote Pro is the default preset, so this is the "already selected" case.
    fireEvent.click(screen.getByTitle('#1E1B4B'));
    expect(hasReset()).toBe(true);

    fireEvent.click(matrixButton('Keynote Pro'));
    expect(hasReset(), 're-selecting the active backdrop must still clear the colour').toBe(false);
    cleanup();
  });
});

describe('VibePresetsPanel: choosing a backdrop never leaves an override behind', () => {
  const baseProps = (over: Record<string, any> = {}) => ({
    currentPreset: VIBE_PRESETS['stripe-mesh'],
    onSelectPreset: vi.fn(),
    aspectRatio: '16:9',
    onChangeAspectRatio: vi.fn(),
    framingMode: 'fit',
    onChangeFramingMode: vi.fn(),
    shadowMode: 'subtle',
    onChangeShadowMode: vi.fn(),
    showSpotlight: false, onToggleSpotlight: vi.fn(),
    showCursor: true, onToggleCursor: vi.fn(),
    showHud: false, onToggleHud: vi.fn(),
    followCursor: true, onToggleFollowCursor: vi.fn(),
    soundEnabled: true, onToggleSound: vi.fn(),
    onUpdatePresetBorderRadius: vi.fn(),
    cursorTheme: 'mac-obsidian', onChangeCursorTheme: vi.fn(),
    cursorScale: 1.2, onChangeCursorScale: vi.fn(),
    cursorSmoothing: 0.6, onChangeCursorSmoothing: vi.fn(),
    showCaptions: false, onToggleCaptions: vi.fn(),
    captionStyle: 'tiktok-bold', onChangeCaptionStyle: vi.fn(),
    captionBackdrop: 70, onChangeCaptionBackdrop: vi.fn(),
    onChangeBackdropParams: vi.fn(),
    onSelectBackgroundColor: vi.fn(),
    onSelectBackgroundImage: vi.fn(),
    backgroundImageUrl: 'blob:uploaded-image',
    ...over
  });

  it('re-clicking the active mesh type after an image upload clears the image and the colour', () => {
    const props = baseProps();
    render(React.createElement(VibePresetsPanel, props as any));
    fireEvent.click(matrixButton('Stripe Mesh'));
    expect(props.onSelectPreset).not.toHaveBeenCalled(); // already the active preset...
    expect(props.onSelectBackgroundImage).toHaveBeenCalledWith(null, null); // ...but the upload is dropped
    expect(props.onSelectBackgroundColor).toHaveBeenCalledWith(null);
    cleanup();
  });

  it('choosing a different backdrop selects its preset (the editor then clears both overrides)', () => {
    const props = baseProps();
    render(React.createElement(VibePresetsPanel, props as any));
    fireEvent.click(matrixButton('Linear Cosmic'));
    expect(props.onSelectPreset).toHaveBeenCalledTimes(1);
    expect(props.onSelectPreset.mock.calls[0][0].id).toBe('linear-cosmic');
    cleanup();
  });
});
