# Firestore Rules for Friends + Notifications

Paste the updated rules into your Firestore Security Rules editor to enable friend requests and notifications while keeping strong security constraints.

Notes:
- Notifications are readable only by the recipient (userId == auth.uid).
- Any authenticated user can create a notification addressed to someone else only when they are the sender (fromUserId == auth.uid) and type is friend_request, friend_accept, or activity_invite.
- Only the recipient can delete a notification or mark it as read.
- Profiles remain owner-writable, with narrow, validated exceptions that allow the recipient of a friend request to:
  - Accept: add themselves to the sender's friends and remove themselves from the sender's requestsSent.
  - Decline: remove themselves from the sender's requestsSent.
  - Remove: either party may remove themselves from the other person's friends array (disconnect), ensuring connections are strictly two-way and can be broken by either user.

Replace your existing rules with the following (merge your Activities/Chats blocks if you have custom logic — the blocks below include the ones you shared). This version also enables activity invites (notifications of type activity_invite), and lets the sender retract their own pending activity_invite similar to canceling a friend_request:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }

    // ---------- PROFILES ----------
    match /profiles/{uid} {
      allow read: if isSignedIn();

      // Owner can manage their own document
      allow create, update, delete: if isSignedIn() && request.auth.uid == uid

      // Accept friend request
      || (
        isSignedIn() &&
        request.resource.data.diff(resource.data).changedKeys().hasOnly(['friends','requestsSent']) &&
        (('friends' in request.resource.data) &&
          request.resource.data.friends.size() == ((('friends' in resource.data) ? resource.data.friends.size() : 0) + 1) &&
          request.resource.data.friends.hasAll((('friends' in resource.data) ? resource.data.friends : [])) &&
          (request.auth.uid in request.resource.data.friends)
        ) &&
        (('requestsSent' in resource.data) &&
          resource.data.requestsSent.size() == ((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent.size() : 0) + 1) &&
          resource.data.requestsSent.hasAll((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent : [])) &&
          (request.auth.uid in resource.data.requestsSent) &&
          !(request.auth.uid in request.resource.data.requestsSent)
        )
      )

      // Decline friend request
      || (
        isSignedIn() &&
        request.resource.data.diff(resource.data).changedKeys().hasOnly(['requestsSent']) &&
        ('requestsSent' in resource.data) &&
        resource.data.requestsSent.size() == ((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent.size() : 0) + 1) &&
        resource.data.requestsSent.hasAll((('requestsSent' in request.resource.data) ? request.resource.data.requestsSent : [])) &&
        (request.auth.uid in resource.data.requestsSent) &&
        !(request.auth.uid in request.resource.data.requestsSent)
      )

      // Remove friend
      || (
        isSignedIn() &&
        request.resource.data.diff(resource.data).changedKeys().hasOnly(['friends']) &&
        ('friends' in resource.data) &&
        resource.data.friends.size() == ((('friends' in request.resource.data) ? request.resource.data.friends.size() : 0) + 1) &&
        resource.data.friends.hasAll((('friends' in request.resource.data) ? request.resource.data.friends : [])) &&
        (request.auth.uid in resource.data.friends) &&
        !(request.auth.uid in request.resource.data.friends)
      );
    }

    // ---------- ACTIVITIES ----------
    match /activities/{activityId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.creatorId == request.auth.uid;

      allow update: if isSignedIn() && (
        resource.data.creatorId == request.auth.uid ||
        (
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['joinedUserIds']) &&
          ('joinedUserIds' in request.resource.data) &&
          (
            // JOIN
            request.resource.data.joinedUserIds.size() == ((('joinedUserIds' in resource.data) ? resource.data.joinedUserIds.size() : 0) + 1) &&
            (('joinedUserIds' in resource.data) ? request.resource.data.joinedUserIds.hasAll(resource.data.joinedUserIds) : true) &&
            (request.auth.uid in request.resource.data.joinedUserIds) &&
            (('maxParticipants' in resource.data) ? (request.resource.data.joinedUserIds.size() <= resource.data.maxParticipants) : true)
          ) || (
            // LEAVE
            ('joinedUserIds' in resource.data) &&
            (request.resource.data.joinedUserIds.size() + 1 == resource.data.joinedUserIds.size()) &&
            resource.data.joinedUserIds.hasAll(request.resource.data.joinedUserIds) &&
            (request.auth.uid in resource.data.joinedUserIds) &&
            !(request.auth.uid in request.resource.data.joinedUserIds)
          )
        )
      );

      allow delete: if isSignedIn() && (
        resource.data.creatorId == request.auth.uid ||
        (('joinedUserIds' in resource.data) && resource.data.joinedUserIds is list && resource.data.joinedUserIds.size() == 1 && (request.auth.uid in resource.data.joinedUserIds)) ||
        (('joinedUserIds' in resource.data) && resource.data.joinedUserIds is list && resource.data.joinedUserIds.size() == 0)
      );
    }

    // Helpers for friends
    function hasFriend(u1, u2) {
      return (
        get(/databases/$(database)/documents/profiles/$(u1)).data != null &&
        ("friends" in get(/databases/$(database)/documents/profiles/$(u1)).data) &&
        (get(/databases/$(database)/documents/profiles/$(u1)).data.friends is list) &&
        get(/databases/$(database)/documents/profiles/$(u1)).data.friends.hasAny([u2])
      );
    }
    function isMutualFriends(u1, u2) {
      return hasFriend(u1, u2) && hasFriend(u2, u1);
    }

    // ---------- CHATS ----------
    match /chats/{chatId} {

      // CREATE
      allow create: if isSignedIn() && (
        // Activity chat (deterministic id)
        (
          ('activityId' in request.resource.data) &&
          (request.auth.uid in request.resource.data.participants) &&
          (request.auth.uid in get(/databases/$(database)/documents/activities/$(request.resource.data.activityId)).data.joinedUserIds)
        ) ||
        // DM (mutual friends OR allow any signed in users for flexibility)
        (
          ('type' in request.resource.data) && request.resource.data.type == 'dm' &&
          ('participants' in request.resource.data) && request.resource.data.participants is list &&
          request.resource.data.participants.size() == 2 &&
          (request.auth.uid in request.resource.data.participants) &&
          (
            isMutualFriends(request.resource.data.participants[0], request.resource.data.participants[1])
            // Allow DM between any users (comment above line and uncomment below if you want stricter friend-only DMs)
            // || true
          )
        ) ||
        // Custom group (non-activity); creator is included
        (
          ('type' in request.resource.data) && request.resource.data.type == 'Group' &&
          !('activityId' in request.resource.data) &&
          ('participants' in request.resource.data) && request.resource.data.participants is list &&
          (request.auth.uid in request.resource.data.participants) &&
          (request.resource.data.participants.size() >= 2)
        )
      );

      // READ
      allow read: if isSignedIn() && (request.auth.uid in resource.data.participants);

      // DELETE (when last participant or zero participants)
      allow delete: if isSignedIn() && (
        (request.auth.uid in resource.data.participants && resource.data.participants is list && resource.data.participants.size() == 1) ||
        (resource.data.participants is list && resource.data.participants.size() == 0)
      );

      // UPDATE (fine-grained)
      allow update: if isSignedIn() && (
        // 1) Participants may update lightweight preview fields (BATCH WRITE SUPPORT)
        (
          (request.auth.uid in resource.data.participants) &&
          (
            request.resource.data.diff(resource.data).changedKeys().hasOnly([
              'lastMessageText','lastMessageType','lastMessageSenderId','lastMessageTimestamp'
            ]) ||
            // Allow empty update (for batch writes that only add message subcollection)
            request.resource.data.diff(resource.data).changedKeys().size() == 0
          )
        )

        // 2) Read receipts: support both 'reads' and 'seen' for backward compatibility
        || (
          (request.auth.uid in resource.data.participants) &&
          (
            // 'reads' field (new pattern)
            (
              request.resource.data.diff(resource.data).changedKeys().hasOnly(['reads']) &&
              ('reads' in request.resource.data) &&
              request.resource.data.reads.diff(
                ('reads' in resource.data) ? resource.data.reads : {}
              ).changedKeys().hasOnly([request.auth.uid]) &&
              request.resource.data.reads[request.auth.uid] is timestamp
            ) ||
            // 'seen' field (legacy pattern)
            (
              request.resource.data.diff(resource.data).changedKeys().hasOnly(['seen']) &&
              ('seen' in request.resource.data) &&
              request.resource.data.seen.diff(
                ('seen' in resource.data) ? resource.data.seen : {}
              ).changedKeys().hasOnly([request.auth.uid]) &&
              request.resource.data.seen[request.auth.uid] is timestamp
            ) ||
            // 'lastReadBy' field (alternative pattern)
            (
              request.resource.data.diff(resource.data).changedKeys().hasOnly(['lastReadBy']) &&
              ('lastReadBy' in request.resource.data) &&
              request.resource.data.lastReadBy.diff(
                ('lastReadBy' in resource.data) ? resource.data.lastReadBy : {}
              ).changedKeys().hasOnly([request.auth.uid]) &&
              request.resource.data.lastReadBy[request.auth.uid] is timestamp
            )
          )
        )

        // 3) Typing indicators: only my own key (support adding/updating/deleting)
        || (
          (request.auth.uid in resource.data.participants) &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['typing']) &&
          ('typing' in request.resource.data) &&
          request.resource.data.typing.diff(
            ('typing' in resource.data) ? resource.data.typing : {}
          ).changedKeys().hasOnly([request.auth.uid]) &&
          (
            // Allow timestamp or deletion
            request.resource.data.typing[request.auth.uid] is timestamp ||
            !(request.auth.uid in request.resource.data.typing)
          )
        )

        // 4) Edit group title/photo (participants; not for DMs)
        || (
          (request.auth.uid in resource.data.participants) &&
          (resource.data.type == 'Group' || resource.data.type == 'ActivityGroup') &&
          (
            request.resource.data.diff(resource.data).changedKeys().hasOnly(['title']) ||
            request.resource.data.diff(resource.data).changedKeys().hasOnly(['photoUrl']) ||
            request.resource.data.diff(resource.data).changedKeys().hasOnly(['title','photoUrl'])
          )
        )

        // 5) Add users (participants can add to group; activity self-join handled below)
        || (
          (request.auth.uid in resource.data.participants) &&
          // allow adding participants only for non-activity custom groups (Group). Activity join is handled separately.
          (resource.data.type in ['Group','ActivityGroup','dm'] ? (resource.data.type == 'Group') : true) &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['participants']) &&
          request.resource.data.participants.size() >= resource.data.participants.size() &&
          request.resource.data.participants.hasAll(resource.data.participants)
        )

        // 6) Remove self (any time)
        || (
          (request.auth.uid in resource.data.participants) &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['participants']) &&
          resource.data.participants.hasAll(request.resource.data.participants) &&
          (request.auth.uid in resource.data.participants) &&
          !(request.auth.uid in request.resource.data.participants)
        )

        // 7) Activity self-join (kept from your original rules)
        || (
          ('activityId' in resource.data) &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['participants']) &&
          request.resource.data.participants.size() == resource.data.participants.size() + 1 &&
          request.resource.data.participants.hasAll(resource.data.participants) &&
          (request.auth.uid in request.resource.data.participants) &&
          (request.auth.uid in get(/databases/$(database)/documents/activities/$(resource.data.activityId)).data.joinedUserIds)
        )

        // 8) Last participant removes themselves → []
        || (
          request.resource.data.diff(resource.data).changedKeys().hasOnly(['participants']) &&
          ('participants' in resource.data) &&
          resource.data.participants is list &&
          resource.data.participants.size() == 1 &&
          (request.auth.uid in resource.data.participants) &&
          request.resource.data.participants.size() == 0
        )
      );

      // Messages subcollection
      match /messages/{messageId} {
        allow read: if isSignedIn() &&
          (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants);

        allow create: if isSignedIn() &&
          request.auth.uid == request.resource.data.senderId &&
          (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants) &&
          request.resource.data.type in ['text', 'image', 'audio', 'system'] &&
          request.resource.data.timestamp is timestamp;

        // Allow update only for system to add reactions or other metadata (optional)
        allow update: if false;
        
        // Prevent message deletion by users
        allow delete: if false;

        // Reactions subcollection
        match /reactions/{userId} {
          allow read: if isSignedIn() &&
            (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants);

          allow create, update: if isSignedIn() &&
            request.auth.uid == userId &&
            (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants) &&
            request.resource.data.emoji is string &&
            request.resource.data.emoji.size() <= 10 &&
            request.resource.data.createdAt is timestamp;

          allow delete: if isSignedIn() &&
            request.auth.uid == userId &&
            (request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants);
        }
      }
    }

    // ---------- NOTIFICATIONS ----------
    match /notifications/{id} {
      allow read: if isSignedIn() && resource.data.userId == request.auth.uid;

      allow create: if isSignedIn()
        && request.auth.uid == request.resource.data.fromUserId
        && request.resource.data.userId is string
        && request.resource.data.type in ['friend_request','friend_accept','activity_invite']
        && request.resource.data.userId != request.auth.uid;

      allow update: if isSignedIn()
        && resource.data.userId == request.auth.uid
        && request.resource.data.diff(resource.data).changedKeys().hasOnly(['read'])
        && (resource.data.read == false) && (request.resource.data.read == true);

      allow delete: if isSignedIn() && (
        resource.data.userId == request.auth.uid ||
        (resource.data.fromUserId == request.auth.uid && resource.data.type in ['friend_request','activity_invite'])
      );
    }

    // Fallback deny
    match /{document=**} {
      allow read, write: if false;
    }
  }
}

```

After publishing these rules, try sending a friend request again from another user's profile.
