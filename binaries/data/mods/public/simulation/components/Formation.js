function Formation() {}

Formation.prototype.Schema =
	"<element name='FormationName' a:help='Name of the formation'>" +
		"<text/>" +
	"</element>" +
	"<element name='Icon'>" +
		"<text/>" +
	"</element>" +
	"<element name='RequiredMemberCount' a:help='Minimum number of entities the formation should contain (at least 2)'>" +
		"<data type='integer'>" +
		  "<param name='minInclusive'>"+
		    "2"+
		  "</param>"+
		"</data>" +
	"</element>" +
	"<element name='DisabledTooltip' a:help='Tooltip shown when the formation is disabled'>" +
		"<text/>" +
	"</element>" +
	"<element name='SpeedMultiplier' a:help='The speed of the formation is determined by the minimum speed of all members, multiplied with this number.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='FormationShape' a:help='Formation shape, currently supported are square, triangle and special, where special will be defined in the source code.'>" +
		"<text/>" +
	"</element>" +
	"<element name='ShiftRows' a:help='Set the value to true to shift subsequent rows'>" +
		"<text/>" +
	"</element>" +
	"<element name='SortingClasses' a:help='Classes will be added to the formation in this order. Where the classes will be added first depends on the formation'>" +
		"<text/>" +
	"</element>" +
	"<optional>" +
		"<element name='SortingOrder' a:help='The order of sorting. This defaults to an order where the formation is filled from the first row to the last, and the center of each row to the sides. Other possible sort orders are \"fillFromTheSides\", where the most important units are on the sides of each row, and \"fillToTheCenter\", where the most vulerable units are right in the center of the formation. '>" +
			"<text/>" +
		"</element>" +
	"</optional>" +
	"<element name='WidthDepthRatio' a:help='Average width/depth, counted in number of units.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='Sloppyness' a:help='Sloppyness in meters (the max difference between the actual and the perfectly aligned formation position'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<optional>" +
		"<element name='MinColumns' a:help='When possible, this number of colums will be created. Overriding the wanted width depth ratio'>" +
			"<data type='nonNegativeInteger'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='MaxColumns' a:help='When possible within the number of units, and the maximum number of rows, this will be the maximum number of columns.'>" +
			"<data type='nonNegativeInteger'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='MaxRows' a:help='The maximum number of rows in the formation'>" +
			"<data type='nonNegativeInteger'/>" +
		"</element>" +
	"</optional>" +
	"<optional>" +
		"<element name='CenterGap' a:help='The size of the central gap, expressed in number of units wide'>" +
			"<ref name='nonNegativeDecimal'/>" +
		"</element>" +
	"</optional>" +
	"<element name='UnitSeparationWidthMultiplier' a:help='Place the units in the formation closer or further to each other. The standard separation is the footprint size.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='UnitSeparationDepthMultiplier' a:help='Place the units in the formation closer or further to each other. The standard separation is the footprint size.'>" +
		"<ref name='nonNegativeDecimal'/>" +
	"</element>" +
	"<element name='AnimationVariants' a:help='Give a list of animation variants to use for the particular formation members, based on their positions'>" +
		"<text a:help='example text: \"1..1,1..-1:animationVariant1;2..2,1..-1;animationVariant2\", this will set animationVariant1 for the first row, and animation2 for the second row. The first part of the numbers (1..1 and 2..2) means the row range. Every row between (and including) those values will switch animationvariants. The second part of the numbers (1..-1) denote the columns inside those rows that will be affected. Note that in both cases, you can use -1 for the last row/column, -2 for the second to last, etc.'/>" +
	"</element>";

var g_ColumnDistanceThreshold = 128; // distance at which we'll switch between column/box formations

Formation.prototype.variablesToSerialize = [
	"lastOrderVariant",
	"members",
	"memberPositions",
	"maxRowsUsed",
	"maxColumnsUsed",
	"waitingOnController",
	"columnar",
	"rearrange",
	"formationMembersWithAura",
	"width",
	"depth",
	"oldOrientation",
	"twinFormations",
	"formationSeparation",
	"offsets"
];

Formation.prototype.Init = function(deserialized = false)
{
	this.sortingClasses = this.template.SortingClasses.split(/\s+/g);
	this.shiftRows = this.template.ShiftRows == "true";
	this.separationMultiplier = {
		"width": +this.template.UnitSeparationWidthMultiplier,
		"depth": +this.template.UnitSeparationDepthMultiplier
	};
	this.sloppyness = +this.template.Sloppyness;
	this.widthDepthRatio = +this.template.WidthDepthRatio;
	this.minColumns = +(this.template.MinColumns || 0);
	this.maxColumns = +(this.template.MaxColumns || 0);
	this.maxRows = +(this.template.MaxRows || 0);
	this.centerGap = +(this.template.CenterGap || 0);

	if (this.template.AnimationVariants)
	{
		this.animationvariants = [];
		let differentAnimationVariants = this.template.AnimationVariants.split(/\s*;\s*/);
		// loop over the different rectangulars that will map to different animation variants
		for (let rectAnimationVariant of differentAnimationVariants)
		{
			let rect, replacementAnimationVariant;
			[rect, replacementAnimationVariant] = rectAnimationVariant.split(/\s*:\s*/);
			let rows, columns;
			[rows, columns] = rect.split(/\s*,\s*/);
			let minRow, maxRow, minColumn, maxColumn;
			[minRow, maxRow] = rows.split(/\s*\.\.\s*/);
			[minColumn, maxColumn] = columns.split(/\s*\.\.\s*/);
			this.animationvariants.push({
				"minRow": +minRow,
				"maxRow": +maxRow,
				"minColumn": +minColumn,
				"maxColumn": +maxColumn,
				"name": replacementAnimationVariant
			});
		}
	}

	this.lastOrderVariant = undefined;

	this.members = []; // entity IDs currently belonging to this formation
	this.memberPositions = {};
	this.maxRowsUsed = 0;
	this.maxColumnsUsed = [];
	this.waitingOnController = []; // entities that are waiting on the controller.
	this.columnar = false; // whether we're travelling in column (vs box) formation
	this.rearrange = true; // whether we should rearrange all formation members
	this.formationMembersWithAura = []; // Members with a formation aura
	this.width = 0;
	this.depth = 0;
	this.oldOrientation = {"sin": 0, "cos": 0};
	this.twinFormations = [];
	// distance from which two twin formations will merge into one.
	this.formationSeparation = 0;

	if (deserialized)
		return;

	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer)
		.SetInterval(this.entity, IID_Formation, "ShapeUpdate", 1000, 1000, null);
};

Formation.prototype.Serialize = function()
{
	let result = {};
	for (let key of this.variablesToSerialize)
		result[key] = this[key];

	return result;
};

Formation.prototype.Deserialize = function(data)
{
	this.Init(true);
	for (let key in data)
		this[key] = data[key];
};

/**
 * Set the value from which two twin formations will become one.
 */
Formation.prototype.SetFormationSeparation = function(value)
{
	this.formationSeparation = value;
};

Formation.prototype.GetSize = function()
{
	return {"width": this.width, "depth": this.depth};
};

Formation.prototype.GetSpeedMultiplier = function()
{
	return +this.template.SpeedMultiplier;
};

Formation.prototype.GetMemberCount = function()
{
	return this.members.length;
};

Formation.prototype.GetMembers = function()
{
	return this.members;
};

Formation.prototype.GetClosestMember = function(ent, filter)
{
	var cmpEntPosition = Engine.QueryInterface(ent, IID_Position);
	if (!cmpEntPosition || !cmpEntPosition.IsInWorld())
		return INVALID_ENTITY;

	var entPosition = cmpEntPosition.GetPosition2D();
	var closestMember = INVALID_ENTITY;
	var closestDistance = Infinity;
	for (var member of this.members)
	{
		if (filter && !filter(ent))
			continue;

		var cmpPosition = Engine.QueryInterface(member, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			continue;

		var pos = cmpPosition.GetPosition2D();
		var dist = entPosition.distanceToSquared(pos);
		if (dist < closestDistance)
		{
			closestMember = member;
			closestDistance = dist;
		}
	}
	return closestMember;
};

/**
 * Returns the 'primary' member of this formation (typically the most
 * important unit type), for e.g. playing a representative sound.
 * Returns undefined if no members.
 * TODO: actually implement something like that; currently this just returns
 * the arbitrary first one.
 */
Formation.prototype.GetPrimaryMember = function()
{
	return this.members[0];
};

/**
 * Get the formation animation variant for a certain member of this formation
 * @param entity The entity ID to get the animation for
 * @return The name of the animation variant as defined in the template
 * E.g. "testudo_row1" or undefined if does not exist
 */
Formation.prototype.GetFormationAnimationVariant = function(entity)
{
	if (!this.animationvariants || !this.animationvariants.length || this.columnar || !this.memberPositions[entity])
		return undefined;
	let row = this.memberPositions[entity].row;
	let column = this.memberPositions[entity].column;
	for (let i = 0; i < this.animationvariants.length; ++i)
	{
		let minRow = this.animationvariants[i].minRow;
		if (minRow < 0)
			minRow += this.maxRowsUsed + 1;
		if (row < minRow)
			continue;

		let maxRow = this.animationvariants[i].maxRow;
		if (maxRow < 0)
			maxRow += this.maxRowsUsed + 1;
		if (row > maxRow)
			continue;

		let minColumn = this.animationvariants[i].minColumn;
		if (minColumn < 0)
			minColumn += this.maxColumnsUsed[row] + 1;
		if (column < minColumn)
			continue;

		let maxColumn = this.animationvariants[i].maxColumn;
		if (maxColumn < 0)
			maxColumn += this.maxColumnsUsed[row] + 1;
		if (column > maxColumn)
			continue;

		return this.animationvariants[i].name;
	}
	return undefined;
};

Formation.prototype.SetWaitingOnController = function(ent)
{
	// Rotate the entity to the right angle.
	let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	let cmpEntPosition = Engine.QueryInterface(ent, IID_Position);
	if (cmpEntPosition && cmpEntPosition.IsInWorld() && cmpPosition && cmpPosition.IsInWorld())
		cmpEntPosition.TurnTo(cmpPosition.GetRotation().y);

	if (this.waitingOnController.indexOf(ent) !== -1)
		return;
	this.waitingOnController.push(ent);
};

Formation.prototype.UnsetWaitingOnController = function(ent)
{
	let ind = this.waitingOnController.indexOf(ent);
	if (ind !== -1)
		this.waitingOnController.splice(ind, 1);
};

Formation.prototype.ResetWaitingEntities = function()
{
	this.waitingOnController = [];
};

Formation.prototype.AreAllMembersWaiting = function()
{
	return this.waitingOnController.length === this.members.length;
};

/**
 * Set whether we are allowed to rearrange formation members.
 */
Formation.prototype.SetRearrange = function(rearrange)
{
	this.rearrange = rearrange;
};

/**
 * Initialise the members of this formation.
 * Must only be called once.
 * All members must implement UnitAI.
 */
Formation.prototype.SetMembers = function(ents)
{
	this.members = ents;

	for (var ent of this.members)
	{
		var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		cmpUnitAI.SetFormationController(this.entity);

		var cmpAuras = Engine.QueryInterface(ent, IID_Auras);
		if (cmpAuras && cmpAuras.HasFormationAura())
		{
			this.formationMembersWithAura.push(ent);
			cmpAuras.ApplyFormationAura(ents);
		}
	}

	this.offsets = undefined;
	// Locate this formation controller in the middle of its members
	this.MoveToMembersCenter();

	// Compute the speed etc. of the formation
	this.ComputeMotionParameters();
};

/**
 * Remove the given list of entities.
 * The entities must already be members of this formation.
 * @param {boolean} rename - Whether the removal was part of an entity rename
	(prevents disbanding of the formation when under the member limit).
 */
Formation.prototype.RemoveMembers = function(ents, renamed = false)
{
	this.offsets = undefined;
	this.members = this.members.filter(ent => ents.indexOf(ent) === -1);
	this.waitingOnController = this.waitingOnController.filter(ent => ents.indexOf(ent) === -1);

	for (let ent of ents)
	{
		let cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		cmpUnitAI.UpdateWorkOrders();
		cmpUnitAI.SetFormationController(INVALID_ENTITY);
	}

	for (let ent of this.formationMembersWithAura)
	{
		let cmpAuras = Engine.QueryInterface(ent, IID_Auras);
		cmpAuras.RemoveFormationAura(ents);

		// the unit with the aura is also removed from the formation
		if (ents.indexOf(ent) !== -1)
			cmpAuras.RemoveFormationAura(this.members);
	}

	this.formationMembersWithAura = this.formationMembersWithAura.filter(function(e) { return ents.indexOf(e) == -1; });

	// If there's nobody left, destroy the formation
	// unless this is a rename where we can have 0 members temporarily.
	if (this.members.length < +this.template.RequiredMemberCount && !renamed)
	{
		this.Disband();
		return;
	}

	this.ComputeMotionParameters();

	if (!this.rearrange)
		return;

	// Rearrange the remaining members
	this.MoveMembersIntoFormation(true, true, this.lastOrderVariant);
};

Formation.prototype.AddMembers = function(ents)
{
	this.offsets = undefined;

	for (let ent of this.formationMembersWithAura)
	{
		let cmpAuras = Engine.QueryInterface(ent, IID_Auras);
		cmpAuras.ApplyFormationAura(ents);
	}

	this.members = this.members.concat(ents);

	for (let ent of ents)
	{
		let cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		cmpUnitAI.SetFormationController(this.entity);
		if (!cmpUnitAI.GetOrders().length)
			cmpUnitAI.SetNextState("FORMATIONMEMBER.IDLE");

		let cmpAuras = Engine.QueryInterface(ent, IID_Auras);
		if (cmpAuras && cmpAuras.HasFormationAura())
		{
			this.formationMembersWithAura.push(ent);
			cmpAuras.ApplyFormationAura(this.members);
		}
	}

	this.ComputeMotionParameters();

	if (!this.rearrange)
		return;

	this.MoveMembersIntoFormation(true, true, this.lastOrderVariant);
};

/**
 * Remove all members and destroy the formation.
 */
Formation.prototype.Disband = function()
{
	for (var ent of this.members)
	{
		var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		cmpUnitAI.SetFormationController(INVALID_ENTITY);
	}

	for (var ent of this.formationMembersWithAura)
	{
		var cmpAuras = Engine.QueryInterface(ent, IID_Auras);
		cmpAuras.RemoveFormationAura(this.members);
	}


	this.members = [];
	this.waitingOnController = [];
	this.formationMembersWithAura = [];
	this.offsets = undefined;

	Engine.DestroyEntity(this.entity);
};

/**
 * Set all members to form up into the formation shape.
 * @param {boolean} moveCenter - The formation center will be reinitialised
 * to the center of the units.
 * @param {boolean} force - All individual orders of the formation units are replaced,
 * otherwise the order to walk into formation is just pushed to the front.
 * @param {string | undefined} variant - Variant to be passed as order parameter.
 */
Formation.prototype.MoveMembersIntoFormation = function(moveCenter, force, variant)
{
	if (!this.members.length)
		return;

	var active = [];
	var positions = [];
	let rotations = 0;

	for (var ent of this.members)
	{
		let cmpPosition = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			continue;

		active.push(ent);
		// query the 2D position as exact hight calculation isn't needed
		// but bring the position to the right coordinates
		var pos = cmpPosition.GetPosition2D();
		positions.push(pos);
		rotations += cmpPosition.GetRotation().y;
	}

	var avgpos = Vector2D.average(positions);

	let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	// Reposition the formation if we're told to or if we don't already have a position
	if (moveCenter || (cmpPosition && !cmpPosition.IsInWorld()))
		this.SetupPositionAndHandleRotation(avgpos.x, avgpos.y, rotations / active.length);

	this.lastOrderVariant = variant;
	// Switch between column and box if necessary
	var cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	var walkingDistance = cmpUnitAI.ComputeWalkingDistance();
	var columnar = walkingDistance > g_ColumnDistanceThreshold;
	if (columnar != this.columnar)
	{
		this.columnar = columnar;
		this.offsets = undefined;
	}

	let offsetsChanged = false;
	var newOrientation = this.GetEstimatedOrientation(avgpos);
	var dSin = Math.abs(newOrientation.sin - this.oldOrientation.sin);
	var dCos = Math.abs(newOrientation.cos - this.oldOrientation.cos);
	// If the formation existed, only recalculate positions if the turning agle is somewhat biggish
	if (!this.offsets || dSin > 1 || dCos > 1)
	{
		this.offsets = this.ComputeFormationOffsets(active, positions);
		offsetsChanged = true;
	}

	this.oldOrientation = newOrientation;

	var xMax = 0;
	var yMax = 0;
	var xMin = 0;
	var yMin = 0;

	if (force)
		// Reset waitingOnController as FormationWalk is called.
		this.ResetWaitingEntities();

	for (let i = 0; i < this.offsets.length; ++i)
	{
		let offset = this.offsets[i];

		let cmpUnitAI = Engine.QueryInterface(offset.ent, IID_UnitAI);
		if (!cmpUnitAI)
		{
			warn("Entities without UnitAI in formation are not supported.");
			continue;
		}

		let data =
		{
			"target": this.entity,
			"x": offset.x,
			"z": offset.y,
			"offsetsChanged": offsetsChanged,
			"variant": variant
		};
		cmpUnitAI.AddOrder("FormationWalk", data, !force);
		xMax = Math.max(xMax, offset.x);
		yMax = Math.max(yMax, offset.y);
		xMin = Math.min(xMin, offset.x);
		yMin = Math.min(yMin, offset.y);
	}
	this.width = xMax - xMin;
	this.depth = yMax - yMin;
};

Formation.prototype.MoveToMembersCenter = function()
{
	let positions = [];
	let rotations = 0;

	for (let ent of this.members)
	{
		let cmpPosition = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPosition || !cmpPosition.IsInWorld())
			continue;

		positions.push(cmpPosition.GetPosition2D());
		rotations += cmpPosition.GetRotation().y;
	}

	let avgpos = Vector2D.average(positions);

	this.SetupPositionAndHandleRotation(avgpos.x, avgpos.y, rotations / positions.length);
};

/**
* Set formation position.
* If formation is not in world at time this is called, set new rotation and flag for range manager.
*/
Formation.prototype.SetupPositionAndHandleRotation = function(x, y, rot)
{
	let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (!cmpPosition)
		return;
	let wasInWorld = cmpPosition.IsInWorld();
	cmpPosition.JumpTo(x, y);

	if (wasInWorld)
		return;

	let cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	cmpRangeManager.SetEntityFlag(this.entity, "normal", false);
	cmpPosition.TurnTo(rot);
}

Formation.prototype.GetAvgFootprint = function(active)
{
	var footprints = [];
	for (var ent of active)
	{
		var cmpFootprint = Engine.QueryInterface(ent, IID_Footprint);
		if (cmpFootprint)
			footprints.push(cmpFootprint.GetShape());
	}
	if (!footprints.length)
		return {"width":1, "depth": 1};

	var r = {"width": 0, "depth": 0};
	for (var shape of footprints)
	{
		if (shape.type == "circle")
		{
			r.width += shape.radius * 2;
			r.depth += shape.radius * 2;
		}
		else if (shape.type == "square")
		{
			r.width += shape.width;
			r.depth += shape.depth;
		}
	}
	r.width /= footprints.length;
	r.depth /= footprints.length;
	return r;
};

Formation.prototype.ComputeFormationOffsets = function(active, positions)
{
	var separation = this.GetAvgFootprint(active);
	separation.width *= this.separationMultiplier.width;
	separation.depth *= this.separationMultiplier.depth;

	if (this.columnar)
		var sortingClasses = ["Cavalry","Infantry"];
	else
		var sortingClasses = this.sortingClasses.slice();
	sortingClasses.push("Unknown");

	// the entities will be assigned to positions in the formation in
	// the same order as the types list is ordered
	var types = {};
	for (var i = 0; i < sortingClasses.length; ++i)
		types[sortingClasses[i]] = [];

	for (var i in active)
	{
		var cmpIdentity = Engine.QueryInterface(active[i], IID_Identity);
		var classes = cmpIdentity.GetClassesList();
		var done = false;
		for (var c = 0; c < sortingClasses.length; ++c)
		{
			if (classes.indexOf(sortingClasses[c]) > -1)
			{
				types[sortingClasses[c]].push({"ent": active[i], "pos": positions[i]});
				done = true;
				break;
			}
		}
		if (!done)
			types["Unknown"].push({"ent": active[i], "pos": positions[i]});
	}

	var count = active.length;

	let shape = this.template.FormationShape;
	var shiftRows = this.shiftRows;
	var centerGap = this.centerGap;
	let sortingOrder = this.template.SortingOrder;
	var offsets = [];

	// Choose a sensible size/shape for the various formations, depending on number of units
	var cols;

	if (this.columnar)
	{
		shape = "square";
		cols = Math.min(count,3);
		shiftRows = false;
		centerGap = 0;
		sortingOrder = null;
	}
	else
	{
		let depth = Math.sqrt(count / this.widthDepthRatio);
		if (this.maxRows && depth > this.maxRows)
			depth = this.maxRows;
		cols = Math.ceil(count / Math.ceil(depth) + (this.shiftRows ? 0.5 : 0));
		if (cols < this.minColumns)
			cols = Math.min(count, this.minColumns);
		if (this.maxColumns && cols > this.maxColumns && this.maxRows != depth)
			cols = this.maxColumns;
	}

	// define special formations here
	if (this.template.FormationName == "Scatter")
	{
		var width = Math.sqrt(count) * (separation.width + separation.depth) * 2.5;

		for (var i = 0; i < count; ++i)
		{
			var obj = new Vector2D(randFloat(0, width), randFloat(0, width));
			obj.row = 1;
			obj.column = i + 1;
			offsets.push(obj);
		}
	}

	// For non-special formations, calculate the positions based on the number of entities
	this.maxColumnsUsed = [];
	this.maxRowsUsed = 0;
	if (shape != "special")
	{
		offsets = [];
		var r = 0;
		var left = count;
		// while there are units left, start a new row in the formation
		while (left > 0)
		{
			// save the position of the row
			var z = -r * separation.depth;
			// switch between the left and right side of the center to have a symmetrical distribution
			var side = 1;
			// determine the number of entities in this row of the formation
			if (shape == "square")
			{
				var n = cols;
				if (shiftRows)
					n -= r%2;
			}
			else if (shape == "triangle")
			{
				if (shiftRows)
					var n = r + 1;
				else
					var n = r * 2 + 1;
			}
			if (!shiftRows && n > left)
				n = left;
			for (var c = 0; c < n && left > 0; ++c)
			{
				// switch sides for the next entity
				side *= -1;
				if (n%2 == 0)
					var x = side * (Math.floor(c/2) + 0.5) * separation.width;
				else
					var x = side * Math.ceil(c/2) * separation.width;
				if (centerGap)
				{
					if (x == 0) // don't use the center position with a center gap
						continue;
					x += side * centerGap / 2;
				}
				var column = Math.ceil(n/2) + Math.ceil(c/2) * side;
				let r1 = randFloat(-1, 1) * this.sloppyness;
				let r2 = randFloat(-1, 1) * this.sloppyness;

				offsets.push(new Vector2D(x + r1, z + r2));
				offsets[offsets.length - 1].row = r+1;
				offsets[offsets.length - 1].column = column;
				left--;
			}
			++r;
			this.maxColumnsUsed[r] = n;
		}
		this.maxRowsUsed = r;
	}

	// make sure the average offset is zero, as the formation is centered around that
	// calculating offset distances without a zero average makes no sense, as the formation
	// will jump to a different position any time
	var avgoffset = Vector2D.average(offsets);
	offsets.forEach(function (o) {o.sub(avgoffset);});

	// sort the available places in certain ways
	// the places first in the list will contain the heaviest units as defined by the order
	// of the types list
	if (sortingOrder == "fillFromTheSides")
		offsets.sort(function(o1, o2) { return Math.abs(o1.x) < Math.abs(o2.x);});
	else if (sortingOrder == "fillToTheCenter")
		offsets.sort(function(o1, o2) {
			return Math.max(Math.abs(o1.x), Math.abs(o1.y)) < Math.max(Math.abs(o2.x), Math.abs(o2.y));
		});

	// query the 2D position of the formation
	var cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	var formationPos = cmpPosition.GetPosition2D();

	// use realistic place assignment,
	// every soldier searches the closest available place in the formation
	var newOffsets = [];
	var realPositions = this.GetRealOffsetPositions(offsets, formationPos);
	for (var i = sortingClasses.length; i; --i)
	{
		var t = types[sortingClasses[i-1]];
		if (!t.length)
			continue;
		var usedOffsets = offsets.splice(-t.length);
		var usedRealPositions = realPositions.splice(-t.length);
		for (var entPos of t)
		{
			var closestOffsetId = this.TakeClosestOffset(entPos, usedRealPositions, usedOffsets);
			usedRealPositions.splice(closestOffsetId, 1);
			newOffsets.push(usedOffsets.splice(closestOffsetId, 1)[0]);
			newOffsets[newOffsets.length - 1].ent = entPos.ent;
		}
	}

	return newOffsets;
};

/**
 * Search the closest position in the realPositions list to the given entity
 * @param ent, the queried entity
 * @param realPositions, the world coordinates of the available offsets
 * @return the index of the closest offset position
 */
Formation.prototype.TakeClosestOffset = function(entPos, realPositions, offsets)
{
	var pos = entPos.pos;
	var closestOffsetId = -1;
	var offsetDistanceSq = Infinity;
	for (var i = 0; i < realPositions.length; i++)
	{
		var distSq = pos.distanceToSquared(realPositions[i]);
		if (distSq < offsetDistanceSq)
		{
			offsetDistanceSq = distSq;
			closestOffsetId = i;
		}
	}
	this.memberPositions[entPos.ent] = {"row": offsets[closestOffsetId].row, "column":offsets[closestOffsetId].column};
	return closestOffsetId;
};

/**
 * Get the world positions for a list of offsets in this formation
 */
Formation.prototype.GetRealOffsetPositions = function(offsets, pos)
{
	var offsetPositions = [];
	var {sin, cos} = this.GetEstimatedOrientation(pos);
	// calculate the world positions
	for (var o of offsets)
		offsetPositions.push(new Vector2D(pos.x + o.y * sin + o.x * cos, pos.y + o.y * cos - o.x * sin));

	return offsetPositions;
};

/**
 * calculate the estimated rotation of the formation
 * based on the first unitAI target position when ordered to walk,
 * based on the current rotation in other cases
 * Return the sine and cosine of the angle
 */
Formation.prototype.GetEstimatedOrientation = function(pos)
{
	var cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	var r = {"sin": 0, "cos": 1};
	var unitAIState = cmpUnitAI.GetCurrentState();
	if (unitAIState == "FORMATIONCONTROLLER.WALKING" || unitAIState == "FORMATIONCONTROLLER.COMBAT.APPROACHING")
	{
		var targetPos = cmpUnitAI.GetTargetPositions();
		if (!targetPos.length)
			return r;
		var d = targetPos[0].sub(pos).normalize();
		if (!d.x && !d.y)
			return r;
		r.cos = d.y;
		r.sin = d.x;
	}
	else
	{
		var cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		if (!cmpPosition)
			return r;
		var rot = cmpPosition.GetRotation().y;
		r.sin = Math.sin(rot);
		r.cos = Math.cos(rot);
	}
	return r;
};

/**
 * Set formation controller's speed based on its current members.
 */
Formation.prototype.ComputeMotionParameters = function()
{
	var maxRadius = 0;
	var minSpeed = Infinity;

	for (var ent of this.members)
	{
		var cmpUnitMotion = Engine.QueryInterface(ent, IID_UnitMotion);
		if (cmpUnitMotion)
			minSpeed = Math.min(minSpeed, cmpUnitMotion.GetWalkSpeed());
	}
	minSpeed *= this.GetSpeedMultiplier();

	var cmpUnitMotion = Engine.QueryInterface(this.entity, IID_UnitMotion);
	cmpUnitMotion.SetSpeedMultiplier(minSpeed / cmpUnitMotion.GetWalkSpeed());
};

Formation.prototype.ShapeUpdate = function()
{
	if (!this.rearrange)
		return;

	// Check the distance to twin formations, and merge if when
	// the formations could collide
	for (let i = this.twinFormations.length - 1; i >= 0; --i)
	{
		// only do the check on one side
		if (this.twinFormations[i] <= this.entity)
			continue;
		let cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
		let cmpOtherPosition = Engine.QueryInterface(this.twinFormations[i], IID_Position);
		let cmpOtherFormation = Engine.QueryInterface(this.twinFormations[i], IID_Formation);
		if (!cmpPosition || !cmpOtherPosition || !cmpOtherFormation ||
		     !cmpPosition.IsInWorld() || !cmpOtherPosition.IsInWorld())
			continue;

		let thisPosition = cmpPosition.GetPosition2D();
		let otherPosition = cmpOtherPosition.GetPosition2D();

		let dx = thisPosition.x - otherPosition.x;
		let dy = thisPosition.y - otherPosition.y;
		let dist = Math.sqrt(dx * dx + dy * dy);

		let thisSize = this.GetSize();
		let otherSize = cmpOtherFormation.GetSize();
		let minDist = Math.max(thisSize.width / 2, thisSize.depth / 2) +
			Math.max(otherSize.width / 2, otherSize.depth / 2) +
			this.formationSeparation;

		if (minDist < dist)
			continue;

		// merge the members from the twin formation into this one
		// twin formations should always have exactly the same orders
		let otherMembers = cmpOtherFormation.members;
		cmpOtherFormation.RemoveMembers(otherMembers);
		this.AddMembers(otherMembers);
		Engine.DestroyEntity(this.twinFormations[i]);
		this.twinFormations.splice(i, 1);
	}
	// Switch between column and box if necessary
	let cmpUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	let walkingDistance = cmpUnitAI.ComputeWalkingDistance();
	let columnar = walkingDistance > g_ColumnDistanceThreshold;
	if (columnar != this.columnar)
	{
		this.offsets = undefined;
		this.columnar = columnar;
		this.MoveMembersIntoFormation(false, true, this.lastOrderVariant);
		// (disable moveCenter so we can't get stuck in a loop of switching
		// shape causing center to change causing shape to switch back)
	}
};

Formation.prototype.ResetOrderVariant = function()
{
	this.lastOrderVariant = undefined;
};

Formation.prototype.OnGlobalOwnershipChanged = function(msg)
{
	// When an entity is captured or destroyed, it should no longer be
	// controlled by this formation

	if (this.members.indexOf(msg.entity) != -1)
		this.RemoveMembers([msg.entity]);
};

Formation.prototype.OnGlobalEntityRenamed = function(msg)
{
	if (this.members.indexOf(msg.entity) === -1)
		return;

	let waitingIndex = this.waitingOnController.indexOf(msg.entity);
	if (waitingIndex !== -1)
		this.waitingOnController.splice(waitingIndex, 1, msg.newentity);

	// Save rearranging to temporarily set it to false.
	let temp = this.rearrange;
	this.rearrange = false;

	// First remove the old member to be able to reuse its position.
	this.RemoveMembers([msg.entity], true);
	this.AddMembers([msg.newentity]);
	this.memberPositions[msg.newentity] = this.memberPositions[msg.entity];

	this.rearrange = temp;
};

Formation.prototype.RegisterTwinFormation = function(entity)
{
	var cmpFormation = Engine.QueryInterface(entity, IID_Formation);
	if (!cmpFormation)
		return;
	this.twinFormations.push(entity);
	cmpFormation.twinFormations.push(this.entity);
};

Formation.prototype.DeleteTwinFormations = function()
{
	for (var ent of this.twinFormations)
	{
		var cmpFormation = Engine.QueryInterface(ent, IID_Formation);
		if (cmpFormation)
			cmpFormation.twinFormations.splice(cmpFormation.twinFormations.indexOf(this.entity), 1);
	}
	this.twinFormations = [];
};

Formation.prototype.LoadFormation = function(newTemplate)
{
	// get the old formation info
	var members = this.members.slice();
	var cmpThisUnitAI = Engine.QueryInterface(this.entity, IID_UnitAI);
	var orders = cmpThisUnitAI.GetOrders().slice();

	this.Disband();

	var newFormation = Engine.AddEntity(newTemplate);

	// Apply the info from the old formation to the new one

	let cmpNewOwnership = Engine.QueryInterface(newFormation, IID_Ownership);
	let cmpOwnership = Engine.QueryInterface(this.entity, IID_Ownership);
	if (cmpOwnership && cmpNewOwnership)
		cmpNewOwnership.SetOwner(cmpOwnership.GetOwner());

	var cmpNewPosition = Engine.QueryInterface(newFormation, IID_Position);
	var cmpPosition = Engine.QueryInterface(this.entity, IID_Position);
	if (cmpPosition && cmpPosition.IsInWorld() && cmpNewPosition)
		cmpNewPosition.TurnTo(cmpPosition.GetRotation().y);

	var cmpFormation = Engine.QueryInterface(newFormation, IID_Formation);
	var cmpNewUnitAI = Engine.QueryInterface(newFormation, IID_UnitAI);
	cmpFormation.SetMembers(members);
	if (orders.length)
		cmpNewUnitAI.AddOrders(orders);
	else
		cmpNewUnitAI.MoveIntoFormation();

	Engine.PostMessage(this.entity, MT_EntityRenamed, { "entity": this.entity, "newentity": newFormation });
};

Engine.RegisterComponentType(IID_Formation, "Formation", Formation);
