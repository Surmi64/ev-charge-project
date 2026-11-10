// Fleet roles as the interface names them. The server's own checks live in
// backend/billing.py (require_fleet_manager) and the row level security policies.
export const FLEET_ROLES = {
  driver: {
    label: 'Driver',
    hint: 'Records charging, fuel and costs for the vehicles you assign, and sees only those.',
    // The same role, told to the person being invited.
    invitee: 'You record charging, fuel and costs for the vehicles assigned to you, and see only those.',
  },
  manager: {
    label: 'Manager',
    hint: 'Sees and edits every vehicle and record, adds vehicles and recurring costs. Cannot manage members.',
    invitee: 'You see and edit every vehicle and record in the fleet, and can add vehicles and recurring costs.',
  },
};
