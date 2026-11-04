// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckboxGroup, RadioGroup } from './ChoiceGroup.js';

const yesNo = [
  { value: 'yes', label: 'Oui' },
  { value: 'no', label: 'Non' },
] as const;

describe('RadioGroup', () => {
  it('is a group named by its legend, described by its hint, with one radio per answer', () => {
    render(
      <RadioGroup
        legend="Enceinte ?"
        hint="Une réponse"
        options={yesNo}
        value={null}
        onChange={vi.fn()}
      />,
    );

    const group = screen.getByRole('group', { name: 'Enceinte ?' });
    expect(group).toHaveAccessibleDescription('Une réponse');
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: 'Oui' })).not.toBeChecked();
  });

  it('shows the chosen answer checked, in shape (the radio) as well as colour (the class)', () => {
    render(<RadioGroup legend="Enceinte ?" options={yesNo} value="no" onChange={vi.fn()} />);

    const no = screen.getByRole('radio', { name: 'Non' });
    expect(no).toBeChecked();
    expect(no.closest('label')).toHaveClass('option--checked');
    expect(screen.getByRole('radio', { name: 'Oui' }).closest('label')).not.toHaveClass(
      'option--checked',
    );
  });

  it('sets an answer of its own apart from the list, as "none of these" is', () => {
    render(
      <RadioGroup
        legend="Dosage"
        options={[
          { value: '500', label: '500 mg' },
          { value: 'unknown', label: 'Je ne sais pas', apart: true },
        ]}
        value={null}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Je ne sais pas' }).closest('label')).toHaveClass(
      'option--none',
    );
    expect(screen.getByRole('radio', { name: '500 mg' }).closest('label')).not.toHaveClass(
      'option--none',
    );
  });

  it('answers with the value of the label tapped, the whole label being the target', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup legend="Enceinte ?" options={yesNo} value={null} onChange={onChange} />);

    await user.click(screen.getByText('Oui'));

    expect(onChange).toHaveBeenCalledWith('yes');
  });

  it('describes the group with its error and marks every answer invalid, never in red', () => {
    render(
      <RadioGroup
        legend="Enceinte ?"
        hint="Une réponse"
        error="Répondez oui ou non."
        options={yesNo}
        value={null}
        onChange={vi.fn()}
      />,
    );

    const group = screen.getByRole('group', { name: 'Enceinte ?' });
    expect(group).toHaveAccessibleDescription('Une réponse Répondez oui ou non.');
    expect(group).toHaveClass('choice-group--invalid');
    // Each answer carries the error too: some screen readers skip a fieldset's description.
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-invalid', 'true');
      expect(radio).toHaveAccessibleDescription('Répondez oui ou non.');
    }
    expect(screen.getByText('Répondez oui ou non.').closest('p')).toHaveClass(
      'choice-group__error',
    );
  });

  it('keeps the answers of two groups apart (each group has its own radio name)', () => {
    render(
      <>
        <RadioGroup legend="A" options={yesNo} value="yes" onChange={vi.fn()} />
        <RadioGroup legend="B" options={yesNo} value="no" onChange={vi.fn()} />
      </>,
    );

    const a = within(screen.getByRole('group', { name: 'A' })).getByRole('radio', { name: 'Oui' });
    const b = within(screen.getByRole('group', { name: 'B' })).getByRole('radio', { name: 'Non' });
    expect(a).toBeChecked();
    expect(b).toBeChecked();
    expect(a.getAttribute('name')).not.toBe(b.getAttribute('name'));
  });
});

describe('choice group styles', () => {
  const baseCss = readFileSync(join(import.meta.dirname, '../styles/base.css'), 'utf8');

  it('rings the whole answer when its control has keyboard focus', () => {
    const ring =
      /\.option:has\(:focus-visible\)\s*\{[^}]*outline:\s*var\(--contour-width\) solid var\(--color-focus\)/;
    expect(baseCss).toMatch(ring);
  });
});

describe('CheckboxGroup', () => {
  it('lists the answers, then sets the exclusive one apart', async () => {
    const onScar = vi.fn();
    const onNone = vi.fn();
    const user = userEvent.setup();
    render(
      <CheckboxGroup
        legend="Situations"
        options={[{ id: 'scar', label: 'Césarienne', checked: true, onChange: onScar }]}
        none={{ id: 'none', label: 'Aucune', checked: false, onChange: onNone }}
      />,
    );

    const boxes = within(screen.getByRole('group', { name: 'Situations' })).getAllByRole(
      'checkbox',
    );
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual(['Césarienne', 'Aucune']);
    expect(boxes[1]?.closest('label')).toHaveClass('option--none');
    expect(boxes[0]).toBeChecked();

    await user.click(screen.getByText('Césarienne'));
    await user.click(screen.getByText('Aucune'));

    expect(onScar).toHaveBeenCalledWith(false);
    expect(onNone).toHaveBeenCalledWith(true);
  });
});
